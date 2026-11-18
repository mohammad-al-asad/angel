
import { Request, RequestHandler, Response } from "express";
import catchAsync from "../../utils/asyncCatch";
import PaymentService from "./payment_gateway.services";
import sendResponse from "../../utils/sendResponse";
import status from "http-status";
import config from "../../config";
import Stripe from "stripe";
import AppError from "../../errors/AppError";
import PaypalServices, { publicApiUrl } from "./paypal.services";

// ---------------------------------------------------------------------------
// PayPal ticket purchase (see paypal.services.ts for the full flow)
// ---------------------------------------------------------------------------

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string
  );

// Small page shown in the browser/WebView after PayPal. The app can also watch for the URL
// /api/v1/payment/paypal_result?status=success|cancelled|failed&orderId=...
const paypalResultPage = (state: string, orderId: string) => {
  const copy: Record<string, { title: string; text: string; color: string }> = {
    success: { title: "Payment successful", text: "Your ticket is confirmed. You can go back to the Thrillio app.", color: "#16a34a" },
    cancelled: { title: "Payment cancelled", text: "No money was taken. You can go back to the Thrillio app and try again.", color: "#d97706" },
    pending: { title: "Payment processing", text: "PayPal is still processing your payment. Your ticket will appear in the app once it completes.", color: "#2563eb" },
    failed: { title: "Payment not completed", text: "Something went wrong with the payment. No ticket was issued. Please try again in the app.", color: "#dc2626" },
  };
  const c = copy[state] || copy.failed;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${c.title} | Thrillio</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#1f2328;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}@media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}}.card{max-width:420px;text-align:center}h1{color:${c.color};font-size:24px;margin:0 0 8px}p{line-height:1.6;margin:0 0 8px}small{opacity:.6}</style></head>
<body><div class="card"><h1>${c.title}</h1><p>${c.text}</p>${orderId ? `<small>Order ${escapeHtml(orderId)}</small>` : ""}</div></body></html>`;
};

const paypalPayment: RequestHandler = catchAsync(async (req, res) => {
  const { eventId, ticketCount, currency } = req.body || {};

  const result = await PaypalServices.createPaypalTicketOrder(req.user.id, {
    eventId,
    ticketCount,
    currency,
  });

  sendResponse(res, {
    success: true,
    statusCode: status.OK,
    message: "Payment order created successfully",
    data: result,
  });
});

// PayPal redirects the user's browser here after they approve the payment
const completeOrder: RequestHandler = async (req, res) => {
  const orderId = typeof req.query.token === "string" ? req.query.token : "";
  const resultUrl = (state: string) =>
    `${publicApiUrl()}/api/v1/payment/paypal_result?status=${state}&orderId=${encodeURIComponent(orderId)}`;

  if (!orderId) {
    return res.redirect(resultUrl("failed"));
  }
  try {
    const result = await PaypalServices.syncPaypalOrder(orderId, { capture: true });
    const state = result.isPaid
      ? "success"
      : ["APPROVED", "PAYER_ACTION_REQUIRED"].includes(result.paypalStatus)
        ? "pending"
        : "failed";
    return res.redirect(resultUrl(state));
  } catch (error: any) {
    console.error(`PayPal complete-order failed for ${orderId}:`, error?.message || error);
    return res.redirect(resultUrl("failed"));
  }
};

// PayPal redirects here if the user cancels
const cancelOrder: RequestHandler = async (req, res) => {
  const orderId = typeof req.query.token === "string" ? req.query.token : "";
  return res.redirect(
    `${publicApiUrl()}/api/v1/payment/paypal_result?status=cancelled&orderId=${encodeURIComponent(orderId)}`
  );
};

const paypalResult: RequestHandler = async (req, res) => {
  const state = typeof req.query.status === "string" ? req.query.status : "failed";
  const orderId = typeof req.query.orderId === "string" ? req.query.orderId : "";
  res
    .status(200)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "Cache-Control": "no-store",
    })
    .send(paypalResultPage(state, orderId));
};

// App calls this after the PayPal screen closes: captures if needed and returns the ticket status
const verifyPayment: RequestHandler = catchAsync(async (req, res) => {
  const result = await PaypalServices.verifyPaypalTicketOrder(req.user.id, req.params.orderId as string);

  sendResponse(res, {
    success: true,
    statusCode: status.OK,
    message: result.isPaid ? "Payment completed" : "Payment not completed yet",
    data: result,
  });
});


const stripe = new Stripe(
  config.stripe_payment_gateway.stripe_secret_key as string,
);

const webhook = config.stripe_payment_gateway.stripe_webhook_secret;

const createConnectedAccountAndOnboardingLink:RequestHandler = catchAsync(
  async (req,  res) => {
    const result =
      await PaymentService.createConnectedAccountAndOnboardingLinkIntoDb(
        req.user,
      );

     sendResponse(res, {
      statusCode: status.OK,
      success: true,
      message: 'Onboarding link created successfully',
      data: { onboardingUrl: result },
    });
  },
);

const refreshOnboardingLink:RequestHandler = catchAsync(
  async (req, res) => {
  

    const result =
      await PaymentService.updateOnboardingLinkIntoDb(req.user.id);

    sendResponse(res, {
      statusCode: status.OK,
      success: true,
      message: 'Onboarding link refreshed successfully',
      data: result,
    });
  },
);

const createPaymentIntent:RequestHandler = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { price, eventId, description } = req.body;

  const result = await PaymentService.createPaymentIntent(userId, {
    price,
    eventId,
    description,
  });

   sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'Payment intent created successfully',
    data: result,
  });
});

const getPaymentStatus :RequestHandler= catchAsync(async (req, res) => {
  const { paymentIntentId } = req.params;

  const result =
    await PaymentService.retrievePaymentStatus(paymentIntentId);

 sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'Payment status retrieved successfully',
    data: result,
  });
});

const createCheckoutSession:RequestHandler= catchAsync(
  async (req, res) => {
    const userId = req.user.id;
    const { price, eventId, ticketCount, description } = req.body;

    const result =
      await PaymentService.createCheckoutSessionForSubscription(
        userId,
        { price,eventId, ticketCount, description },
      );

   sendResponse(res, {
      statusCode: status.OK,
      success: true,
      message: 'Checkout session created successfully',
      data: result,
    });
  },
);

const handleWebhook = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string;

  if (!signature) {
    throw new AppError(status.BAD_REQUEST, 'Missing stripe signature', '');
  }

  let event;

  try {
    if (!req.rawBody) {
      throw new AppError(status.BAD_REQUEST, 'Raw body not available', '');
    }

    event = stripe.webhooks.constructEvent(
      req.rawBody,
      signature,
      webhook as string,
    );
  } catch (err: any) {
    throw new AppError(
      status.BAD_REQUEST,
      `Webhook Error: ${err.message}`,
      '',
    );
  }

  const result = await PaymentService.handleWebhookIntoDb(event);

 sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'Webhook received',
    data: { received: true, result },
  });
});

const findByMyPaymentHistory:RequestHandler=catchAsync(async(req , res)=>{


     const result=await PaymentService.findByMyPaymentHistoryIntoDb(req.user.id, req.query);
      sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'successfully find my payment history ',
    data: { received: true, result },
  });
})


const find_by_all_payment:RequestHandler=catchAsync(async(req , res)=>{

  const result=await  PaymentService.find_by_all_payment_IntoDb(req.query);
  sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'Successfully Find By The All Payamnt Data',
    data: result,
  });
});



const payableEventPayment:RequestHandler=catchAsync(async(req , res)=>{

     const result=await PaymentService. payableEventPaymentIntoDb(req.user.id, req.query);
  sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'Successfully Find Event Payment List',
    data: result,
  });

});

const isLiveEventPaymentExist:RequestHandler=catchAsync(async(req , res)=>{

     const result=await PaymentService.isLiveEventPaymentExistIntoDb(req.user.id, req.params.eventId);
       sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: 'Successfully Find By Live Event Payment',
    data: result,
  });
})



// Called by the app on the "Ticket confirmed" screen with the sessionId from the Stripe redirect
const verifyCheckoutSession: RequestHandler = catchAsync(async (req, res) => {
  const result = await PaymentService.verifyCheckoutSessionIntoDb(req.user.id, req.params.sessionId as string);
  sendResponse(res, {
    statusCode: status.OK,
    success: true,
    message: result.isPaid ? 'Payment confirmed' : 'Payment not completed yet',
    data: result,
  });
});

const paypalPaymentController = {
  verifyCheckoutSession,
  paypalPayment,
  completeOrder,
  cancelOrder,
  verifyPayment,
  paypalResult,
    createConnectedAccountAndOnboardingLink,
  refreshOnboardingLink,
  createPaymentIntent,
  getPaymentStatus,
  createCheckoutSession,
  handleWebhook,
  find_by_all_payment,
  findByMyPaymentHistory,
  payableEventPayment,
  isLiveEventPaymentExist
};

export default paypalPaymentController;
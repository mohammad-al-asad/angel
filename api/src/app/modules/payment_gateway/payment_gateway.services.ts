import { status} from 'http-status';
import Stripe from 'stripe';
import axios from "axios";
import generatePaypalAccessToken, { PaypalTokenResponse } from "../../utils/generatePaypalAccessToken";
import config from "../../config";
import users from '../user/user.model';
import { USER_ACCESSIBILITY } from '../user/user.constant';
import { JwtPayload } from 'jsonwebtoken';
import AppError from '../../errors/AppError';
import mongoose, { Types } from 'mongoose';
import events from '../event/event.model';
import joingroups, { joinusers } from '../join_event_group/join_event_group.model';
import paymentgateways from './payment_gateway.model';
import QueryBuilder from '../../builder/QueryBuilder';
import { payment_method, payment_status } from './payment_gateway.constant';
import notifications from '../notification/notification.model';
import NotificationServices from '../notification/notification.services';
import { NotificationType } from '../notification/notification.constant';
import PaypalServices from './paypal.services';

const stripe = new Stripe(
  config.stripe_payment_gateway.stripe_secret_key as string,
);

interface PaymentDetails {
  price: number;
  eventId: string;
  ticketCount:number;
  description?: string;
}



export interface PaypalOrderResponse {
  id: string;
  status: string;
  links: Array<{
    href: string;
    rel: string;
    method: string;
  }>;
}

export interface PaypalCaptureResponse {
  id: string;
  status: string;
  purchase_units: Array<{
    reference_id: string;
    payments: {
      captures: Array<{
        id: string;
        status: string;
        amount: {
          currency_code: string;
          value: string;
        };
      }>;
    };
  }>;
  payer: {
    email_address: string;
    payer_id: string;
    name: {
      given_name: string;
      surname: string;
    };
  };
}

export interface PaymentPayload {
  amount: string;
  currency?: string;
  itemName?: string;
  itemDescription?: string;
  userId?: string;
  orderId?: string;
}

const paypalPaymentIntoDb = async (
  paymentData: PaymentPayload
): Promise<{ access_token: string; data: PaypalOrderResponse }> => {
  
  const { access_token }: PaypalTokenResponse = await generatePaypalAccessToken();

  const amount = parseFloat(paymentData.amount);
  if (isNaN(amount) || amount <= 0) {
    throw new Error("Invalid payment amount");
  }

  const formattedAmount = amount.toFixed(2);
  const currency = paymentData.currency || "USD";
  const itemName = paymentData.itemName || "Product Purchase";
  const itemDescription = paymentData.itemDescription || "Payment for product/service";

  const baseUrl = (config.payment_getway_credentials.paypal_base_url as string).trim().replace(/\/+$/, "");

  const orderPayload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: paymentData.orderId || "default",
        items: [
          {
            name: itemName,
            description: itemDescription,
            quantity: "1",
            unit_amount: {
              currency_code: currency,
              value: formattedAmount,
            },
          },
        ],
        amount: {
          currency_code: currency,
          value: formattedAmount,
          breakdown: {
            item_total: {
              currency_code: currency,
              value: formattedAmount,
            },
          },
        },
      },
    ],
    application_context: {
      return_url: `${config.payment_getway_credentials.frontend_url}/api/v1/payment/complete-order`,
      cancel_url: `${config.payment_getway_credentials.frontend_url}/api/v1/payment/cancel-order`,
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      brand_name:  "manfra.io",
    },
  };

//   console.log("Creating PayPal order with payload:", JSON.stringify(orderPayload, null, 2));

  try {
    const response = await axios.post<PaypalOrderResponse>(
      `${baseUrl}/v2/checkout/orders`,
      orderPayload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    // console.log("PayPal order created successfully:", response.data.id);

    return {
      access_token,
      data: response.data,
    };
  } catch (error: any) {
    console.error("PayPal API Error:", error.response?.data || error.message);
    throw new Error(
      error.response?.data?.message || 
      error.response?.data?.details?.[0]?.description ||
      "Failed to create PayPal order"
    );
  }
};

const capturePaypalPayment = async (
  orderId: string
): Promise<PaypalCaptureResponse> => {
  
  const { access_token }: PaypalTokenResponse = await generatePaypalAccessToken();

  const baseUrl = (config.payment_getway_credentials.paypal_base_url as string).trim().replace(/\/+$/, "");

  console.log(`Capturing payment for order: ${orderId}`);

  try {
    const response = await axios.post<PaypalCaptureResponse>(
      `${baseUrl}/v2/checkout/orders/${orderId}/capture`,
      {},
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    console.log("Payment captured successfully:", response.data);

    return response.data;
  } catch (error: any) {
    console.error("PayPal Capture Error:", error.response?.data || error.message);
    throw new Error(
      error.response?.data?.message || 
      error.response?.data?.details?.[0]?.description ||
      "Failed to capture PayPal payment"
    );
  }
};

const verifyPaypalPayment = async (
  orderId: string
): Promise<any> => {
  
  const { access_token }: PaypalTokenResponse = await generatePaypalAccessToken();

  const baseUrl = (config.payment_getway_credentials.paypal_base_url as string).trim().replace(/\/+$/, "");

  console.log(`Verifying payment for order: ${orderId}`);

  try {
    const response = await axios.get(
      `${baseUrl}/v2/checkout/orders/${orderId}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    console.log("Payment verified:", response.data);

    return response.data;
  } catch (error: any) {
    console.error("PayPal Verify Error:", error.response?.data || error.message);
    throw new Error(
      error.response?.data?.message || 
      "Failed to verify PayPal payment"
    );
  }
};
 /*
 ..........................
     stripe  account  started 
 ..........................
  */

const createConnectedAccountAndOnboardingLinkIntoDb = async (
  userData: JwtPayload,
) => {
  try {
   
    const normalUser: any = await users.findOne(
      {
        _id: userData.id,
        isDelete: false,
        isVerify: true,
        status: USER_ACCESSIBILITY.isProgress,
      },
      {
        _id: 1,
        stripeAccountId: 1,
        email: 1,
      },
    );

    if (!normalUser) {
      throw new AppError(
        status.NOT_FOUND,
        "User not found or restricted",
        "",
      );
    }

   

    if (normalUser.stripeAccountId) {
      console.log(
        "Retrieving Stripe Account:",
        normalUser.stripeAccountId,
      );

      const account = await stripe.accounts.retrieve(
        normalUser.stripeAccountId,
      );

     

      if (
        account.capabilities?.card_payments === "inactive" &&
        account.capabilities?.transfers === "inactive"
      ) {
        await users.findOneAndUpdate(
          {
            _id: userData.id,
            isDelete: false,
            isVerify: true,
            status: USER_ACCESSIBILITY.isProgress,
          },
          {
            $unset: {
              stripeAccountId: "",
            },
          },
        );

        return await createNewStripeAccountAndLink(
          normalUser.email,
          userData.id,
        );
      }

      return {
        card_payments: account.capabilities?.card_payments,
        transfers: account.capabilities?.transfers,
      };
    }

    return await createNewStripeAccountAndLink(
      normalUser.email,
      userData.id,
    );
  } catch (error: any) {
    console.error("\n========== STRIPE ERROR ==========");
    console.error(error);

    if (error.raw) {
      console.error("Stripe Raw Error:", error.raw);
    }

   
    throw new AppError(
      error.statusCode || status.INTERNAL_SERVER_ERROR,
      error.message || "Something went wrong.",
      error.stack || "",
    );
  }
};

const createNewStripeAccountAndLink = async (
  email: string,
  userId: string,
) => {
  
  const account = await stripe.accounts.create({
    type: "express",
    email,
    country: "US",
    business_type: "individual",
    capabilities: {
      card_payments: {
        requested: true,
      },
      transfers: {
        requested: true,
      },
    },
    settings: {
      payouts: {
        schedule: {
          interval: "manual",
        },
      },
    },
  });

 
  const onboardingLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${config.stripe_payment_gateway.onboarding_refresh_url}?accountId=${account.id}`,
    return_url: config.stripe_payment_gateway.onboarding_return_url,
    type: "account_onboarding",
  });

  

  const updatedUser = await users.findOneAndUpdate(
    {
      _id: userId,
      isDelete: false,
      isVerify: true,
      status: USER_ACCESSIBILITY.isProgress,
    },
    {
      $set: {
        stripeAccountId: account.id,
      },
    },
    {
      new: true,
    },
  );

  if (!updatedUser) {
    throw new AppError(
      status.BAD_REQUEST,
      "Failed to save Stripe Account ID",
      "",
    );
  }

  return {
    onboardingUrl: onboardingLink.url,
    stripeAccountId: account.id,
  };
};




const updateOnboardingLinkIntoDb = async (userId: string) => {
  try {
    const normalUser = await users.findOne(
      {
        $and: [
          {
            _id: userId,
            isDelete: false,
            isVerify: true,
            status: USER_ACCESSIBILITY.isProgress,
          },
        ],
      },
      { _id: 1, stripeAccountId: 1 },
    );

    if (!normalUser) {
      throw new AppError(
        status.NOT_FOUND,
        'this user restrict by the some issues ',
        '',
      );
    }
    const stripAccountId = normalUser?.stripeAccountId;
    const accountLink = await stripe.accountLinks.create({
      account: stripAccountId as string,
      refresh_url: `${config.stripe_payment_gateway.onboarding_refresh_url}?accountId=${stripAccountId}`,
      return_url: config.stripe_payment_gateway.onboarding_return_url,
      type: 'account_onboarding',
    });

    return { link: accountLink.url };
  } catch (error: any) {
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      'update Onboarding Link IntoDb server server unavalable',
      '',
    );
  }
};

const createPaymentIntent = async (
  userId: string,
  paymentDetails: Partial<PaymentDetails>,
) => {
  try {
    const {
      price,
      eventId,
      description = 'Truck service payment',
    } = paymentDetails;

    if (!price || price <= 0) {
      throw new AppError(
        status.BAD_REQUEST,
        'Price must be a positive number',
        '',
      );
    }

    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new AppError(
        status.BAD_REQUEST,
        'Valid truck ID is required',
        '',
      );
    }

    if (!eventId || Types.ObjectId.isValid(eventId)) {
      throw new AppError(
        status.BAD_REQUEST,
        'Valid Subscription ID is required',
        '',
      );
    }

    //isTruck  exist

    // Calculate amount in cents (Stripe uses smallest currency unit)
    const amountInCents = Math.round(price * 100);

    // Create a payment intent details for debugging

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'usd',
        description: description,
        metadata: {
          eventId: eventId,
          userId: userId,
        },
        application_fee_amount: Math.round(amountInCents * 0.05), // 5% platform fee
        transfer_data: {
          destination: '',
        },
      });

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      };
    } catch (stripeError: any) {
      throw new AppError(
        status.BAD_REQUEST,
        `Stripe error: ${stripeError.message}`,
        '',
      );
    }
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      `Payment service unavailable: ${error.message || 'Unknown error'}`,
      '',
    );
  }
};

const retrievePaymentStatus = async (paymentIntentId: string) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    return {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100, // Convert back to dollars
      metadata: paymentIntent.metadata,
      created: new Date(paymentIntent.created * 1000).toISOString(),
    };
  } catch (error: any) {
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      'Could not retrieve payment information',
      '',
    );
  }
};

const createCheckoutSessionForSubscription = async (
  userId: string,
  paymentDetails: PaymentDetails,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      price,
      eventId,
       ticketCount,
      description = 'subscription payment',
    } = paymentDetails;

    if (!price || price <= 0) {
      throw new AppError(
        status.BAD_REQUEST,
        'Price must be a positive number',
        '',
      );
    }

    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new AppError(
        status.BAD_REQUEST,
        'Valid truck ID is required',
        '',
      );
    }

    const user = await users
      .findOne(
        {
          _id: userId,
          isDelete: false,
          isVerify: true,
          status: USER_ACCESSIBILITY.isProgress,
        },
        { stripeAccountId: 1, email: 1 },
      ).lean()
      .session(session); // <- bind to session

    if (!user) {
      throw new AppError(
        status.NOT_FOUND,
        'User not found or not verified',
        '',
      );
    }

    const isExistEventId = await events
      ?.exists({
        _id: paymentDetails.eventId,
      })
      .session(session); // <- bind to session

    if (!isExistEventId) {
      throw new AppError(status.NOT_FOUND, 'Subscription not found', '');
    }

const sessionStripe: any = await stripe.checkout.sessions.create({
  payment_method_types: ['card'], // Apple Pay + Google Pay comes via CARD

  payment_method_options: {
    card: {
      request_three_d_secure: 'automatic',
    },
  },

  line_items: [
    {
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'subscription services',
          description: description,
          metadata: {
            userId: userId,
          },
        },
        unit_amount: Math.round(price * 100),
      },
      quantity: 1,
    },
  ],

  metadata: {
    eventId: eventId,
    userId: userId,
    // kept so the payment record can be rebuilt from Stripe if it goes missing
    price: String(price),
    ticketCount: String(ticketCount ?? 1),
  },

  mode: 'payment',
  success_url: `${config.stripe_payment_gateway.checkout_success_url}?sessionId={CHECKOUT_SESSION_ID}`,
  cancel_url: config.stripe_payment_gateway.checkout_cancel_url,
});



    const paymentBuilder = new paymentgateways({
      currency: sessionStripe.currency,
      sessionId: sessionStripe.id,
      userId: sessionStripe.metadata.userId,
      subscriptionId: isExistEventId._id,
      eventId:sessionStripe.metadata.eventId,
      paymentmethod: sessionStripe.payment_method_types[0],
      payment_status: payment_status.unpaid, // marked paid by syncCheckoutSessionPayment
      price: paymentDetails.price,
      description: paymentDetails.description,
      ticketCount
    });

    const paymentResult = await paymentBuilder.save({ session }); // <- save in transaction

    if (!paymentResult) {
      throw new AppError(
        status.NOT_IMPLEMENTED,
        'issues by the stripe checked session',
        '',
      );
    }

    await session.commitTransaction();
    session.endSession();

    return {
      checkoutUrl: sessionStripe.url,
      sessionId: sessionStripe.id,
    };
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
   status.SERVICE_UNAVAILABLE,
      `Checkout service unavailable: ${error.message || 'Unknown error'}`,
      '',
    );
  }
};


/**
 * Make our payment record match a Stripe Checkout Session.
 *
 * Used by the webhook, the verify endpoint, the ticket/event history endpoints and the
 * unpaid-payment cleanup, so a ticket the user actually paid for is recorded even when
 * the webhook is missing, misconfigured or failed.
 *
 * Idempotent: the "payment completed" notification is only sent on the unpaid -> paid change.
 * Push notification failures never undo the payment.
 */
const syncCheckoutSessionPayment = async (
  sessionOrId: string | Stripe.Checkout.Session,
) => {
  const session =
    typeof sessionOrId === 'string'
      ? await stripe.checkout.sessions.retrieve(sessionOrId)
      : sessionOrId;

  const metadata = session.metadata || {};
  if (session.payment_status !== 'paid') {
    return { isPaid: false, stripeStatus: session.status, payment: await paymentgateways.findOne({ sessionId: session.id }).lean() };
  }
  if (!metadata.userId || !metadata.eventId) {
    throw new AppError(status.BAD_REQUEST, 'Invalid checkout session metadata', '');
  }

  const paidFields = {
    payable_name: session.customer_details?.name || '',
    payable_email: session.customer_details?.email || '',
    payment_intent:
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
    payment_status: payment_status.paid,
    country: session.customer_details?.address?.country || '',
  };

  // 1) unpaid -> paid transition on the record created at checkout
  let payment = await paymentgateways.findOneAndUpdate(
    { sessionId: session.id, payment_status: { $ne: payment_status.paid } },
    { $set: paidFields },
    { new: true },
  );
  let becamePaid = !!payment;

  // 2) already paid -> nothing to do
  if (!payment) {
    payment = await paymentgateways.findOne({ sessionId: session.id });
  }

  // 3) record missing (e.g. deleted by the unpaid cleanup) -> rebuild it from Stripe
  if (!payment) {
    payment = await paymentgateways.create({
      userId: metadata.userId,
      eventId: metadata.eventId,
      subscriptionId: metadata.eventId,
      sessionId: session.id,
      currency: session.currency,
      paymentmethod: payment_method.card,
      price: Number(metadata.price) || (session.amount_total || 0) / 100,
      ticketCount: Number(metadata.ticketCount) || 1,
      description: 'ticket payment',
      ...paidFields,
    });
    becamePaid = true;
  }

  if (becamePaid) {
    try {
      await NotificationServices.createAndSendNotification({
        userId: new Types.ObjectId(metadata.userId),
        title: 'Ticket Payment',
        content: 'Payment completed successfully.',
        type: NotificationType.payment,
        eventId: new Types.ObjectId(metadata.eventId),
      });
    } catch (notifyError: any) {
      console.error('Payment notification failed:', notifyError?.message || notifyError);
    }
  }

  return { isPaid: true, stripeStatus: session.status, payment };
};

/**
 * Check a user's recent unpaid Stripe checkouts against Stripe and record the paid ones.
 * Called before listing ticket/event history so a completed purchase always shows up.
 */
const reconcileUserPendingPayments = async (userId: string) => {
  const pending = await paymentgateways
    .find({
      userId,
      payment_status: payment_status.unpaid,
      sessionId: { $exists: true, $ne: null },
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    })
    .select('sessionId paymentmethod paypalOrderId')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  for (const p of pending) {
    try {
      if (p.paymentmethod === payment_method.paypal && p.paypalOrderId) {
        await PaypalServices.syncPaypalOrder(p.paypalOrderId, { capture: true });
      } else {
        await syncCheckoutSessionPayment(p.sessionId as string);
      }
    } catch (error: any) {
      console.error(`Could not reconcile payment ${p.sessionId}:`, error?.message || error);
    }
  }
};

// Called by the app after Stripe redirects back ("Ticket confirmed" screen)
const verifyCheckoutSessionIntoDb = async (userId: string, sessionId: string) => {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error: any) {
    throw new AppError(status.NOT_FOUND, 'Checkout session not found', error?.message);
  }
  if (session.metadata?.userId !== String(userId)) {
    throw new AppError(status.FORBIDDEN, 'This checkout session does not belong to you', '');
  }

  const result = await syncCheckoutSessionPayment(session);
  return {
    isPaid: result.isPaid,
    stripeStatus: result.stripeStatus,
    payment: result.payment,
  };
};

const handleWebhookIntoDb = async (event: Stripe.Event) => {
 
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    let result = {
      status: false,
      message: 'Unhandled event type',
    };


    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("paymentIntent",paymentIntent );
        

        if (!paymentIntent?.id) {
          throw new AppError(
            status.NOT_FOUND,
            'Missing PaymentIntent ID',
            '',
          );
        }

        result = {
          status: true,
          message: 'Payment successful',
        };
        break;
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;

        if (!account?.id) {
          throw new AppError(
           status.NOT_FOUND,
            'Missing Stripe account ID',
            '',
          );
        }

        result = {
          status: true,
          message: 'Account updated',
        };
        break;
      }

      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const sessionData = event.data.object as Stripe.Checkout.Session;
        // Records the payment as paid (or rebuilds it) and notifies the user.
        // Notification failures are logged inside and never undo the payment.
        const synced = await syncCheckoutSessionPayment(sessionData);
        result = {
          status: true,
          message: synced.isPaid
            ? 'Checkout session successfully recorded'
            : 'Checkout session not paid yet',
        };
        break;
      }

      default:
        console.warn(`⚠️ Unhandled Stripe event type: ${event.type}`);
        break;
    }

    await session.commitTransaction();
    return result;
  } catch (error: any) {
    await session.abortTransaction();
    console.error('❌ Stripe Webhook Error:', error?.message || error);

    throw new AppError(
    status.SERVICE_UNAVAILABLE,
      'Server unavailable – webhook handler failed',
      error,
    );
  } finally {
    await session.endSession();
  }
};

// Method 1: Array of populate objects (RECOMMENDED)
const find_by_all_payment_IntoDb = async (query: Record<string, unknown>) => {
  try {
    const allPaymentQuery = new QueryBuilder(
   paymentgateways
        .find({ payment_status: payment_status.paid })
        .populate([
          {
            path: 'userId',
            select: 'name email phoneNumber photo',
          },
          {
            path: 'eventId',
            select: 'event_title photo'
          },
          // need to event  under hostId ways host information 
          
        ]).select("country payable_email payable_name paymentmethod"),
      query,
    )
      .search([])
      .filter()
      .sort()
      .paginate()
      .fields();

    const all_payments = await allPaymentQuery.modelQuery;
    const meta = await allPaymentQuery.countTotal();
    return { meta, all_payments };
  } catch (error: any) {
    throw new AppError(
      status.NOT_FOUND,
      'issues by the find all payment into db',
      error,
    );
  }
};


const findByMyPaymentHistoryIntoDb=async(userId:string,query: Record<string, unknown>)=>{

     try{
      // record any purchase Stripe has confirmed but we haven't marked paid yet
      await reconcileUserPendingPayments(userId);
 const allPaymentQuery = new QueryBuilder(
   paymentgateways
        .find({userId, payment_status: payment_status.paid })
        .populate([
          {
            path: 'userId',
            select: 'name email  photo',
          },
          {
            path: 'eventId',
            select: 'event_title  date starting_time ending_time'
          },
          
          
        ]).select("price ticketCount  country payable_email payable_name createdAt"),
      query,
    )
      .search([])
      .filter()
      .sort()
      .paginate()
      .fields();

    const my_payments = await allPaymentQuery.modelQuery;
    const meta = await allPaymentQuery.countTotal();
    return { meta, my_payments};
     }
     catch (error: any) {
    throw new AppError(
      status.NOT_FOUND,
      'error by the find By My Payment HistoryIntoDb',
      error,
    );
  }
};

/*

events
            .find({
              userId,
              isDelete: false,
              $expr: {
                $lt: [
                  {
                    $dateFromString: {
                      dateString: { $concat: ["$date", " ", "$starting_time"] },
                    },
                  },
                  now,
                ],
              },
            })
            .select(
              "photo audience_settings.max_capacity event_title createdAt date starting_time ending_time audience_settings.price"
            )


*/

/**
 * "My Event History": events the user attended that have already ENDED.
 * Attended = paid a ticket (paymentgateways, paid) OR joined the event group (joinusers),
 * which is how free events are joined.
 *
 * Response keeps the original shape ({ meta, past_event_list }) where each item has the
 * event populated under `eventId`; payment fields are null for free / joined events.
 */
const payableEventPaymentIntoDb = async (
  userId: string,
  query: Record<string, unknown>
) => {
  const now = new Date();
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 10, 1);
  const userObjectId = new Types.ObjectId(userId);

  try {
    await reconcileUserPendingPayments(userId);

    // 1) Paid tickets
    const payments = await paymentgateways
      .find({ userId: userObjectId, payment_status: payment_status.paid })
      .select("eventId country payable_email payable_name createdAt")
      .sort({ createdAt: -1 })
      .lean();

    // 2) Joined event groups (free events)
    const joined = await joinusers
      .find({ userId: userObjectId, isJoin: true, isDelete: { $ne: true } })
      .select("eventGroupId createdAt")
      .lean();
    const groups = joined.length
      ? await joingroups
          .find({ _id: { $in: joined.map((j: any) => j.eventGroupId) } })
          .select("eventId")
          .lean()
      : [];
    const groupEvent = new Map(
      groups
        .filter((g: any) => g.eventId && Types.ObjectId.isValid(String(g.eventId)))
        .map((g: any) => [String(g._id), String(g.eventId)])
    );

    // One entry per event, preferring the payment record when both exist
    const byEvent = new Map<string, any>();
    for (const p of payments as any[]) {
      if (p.eventId && !byEvent.has(String(p.eventId))) {
        byEvent.set(String(p.eventId), { ...p, isPaid: true });
      }
    }
    for (const j of joined as any[]) {
      const eventId = groupEvent.get(String(j.eventGroupId));
      if (eventId && !byEvent.has(eventId)) {
        byEvent.set(eventId, {
          _id: j._id,
          country: null,
          payable_email: null,
          payable_name: null,
          createdAt: j.createdAt,
          isPaid: false,
        });
      }
    }

    if (!byEvent.size) {
      return { meta: { page, limit, total: 0, totalPage: 0 }, past_event_list: [] };
    }

    // 3) Only events that still exist and have ended (ending_time is an ISO date string)
    const pastFilter = {
      _id: { $in: [...byEvent.keys()].map((id) => new Types.ObjectId(id)) },
      isDelete: { $ne: true },
      $expr: {
        $lt: [
          { $dateFromString: { dateString: "$ending_time", onError: null, onNull: null } },
          now,
        ],
      },
    };

    const total = await events.countDocuments(pastFilter);
    const pastEvents = await events
      .find(pastFilter)
      .select(
        "photo audience_settings.max_capacity event_title createdAt date starting_time ending_time audience_settings.price"
      )
      .sort({ ending_time: -1 }) // most recently finished first
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const past_event_list = pastEvents.map((event: any) => ({
      ...byEvent.get(String(event._id)),
      eventId: event,
    }));

    return {
      meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
      past_event_list,
    };
  } catch (error: any) {
    throw new AppError(
      status.INTERNAL_SERVER_ERROR,
      "Error while finding past event history",
      error
    );
  }
};

const isLiveEventPaymentExistIntoDb = async (userId: string, eventId: string) => {
  try {
    // 1️⃣ Validate eventId exists


    const isExistEvent = await events.findById(eventId).select("_id").lean();
    if (!isExistEvent) {
      throw new AppError(status.NOT_FOUND, "Event not found");
    }


    const result = await paymentgateways
      .findOne(
        {
          eventId: new Types.ObjectId(eventId),
          userId: new Types.ObjectId(userId),
          payment_status: payment_status.paid
        },
        {
          payment_status: 1,
          _id: 0,
        }
      )
      .lean();

     
    if (!result) {
       return {
        status:false,
        payment_status: payment_status.unpaid
       }
    }

    // 3️⃣ Clean response
    return {
      status: true,
      payment_status: result.payment_status,
    };
  } catch (error: any) {
    throw new AppError(
      status.INTERNAL_SERVER_ERROR,
      "Error while checking payment history",
      error
    );
  }
};


const PaymentService = {
  paypalPaymentIntoDb,
  capturePaypalPayment,
  verifyPaypalPayment,
  createConnectedAccountAndOnboardingLinkIntoDb,
  updateOnboardingLinkIntoDb,
  createPaymentIntent,
  retrievePaymentStatus,
  createCheckoutSessionForSubscription,
  handleWebhookIntoDb,
  find_by_all_payment_IntoDb,
  findByMyPaymentHistoryIntoDb,
   payableEventPaymentIntoDb,
   isLiveEventPaymentExistIntoDb,
  syncCheckoutSessionPayment,
  reconcileUserPendingPayments,
  verifyCheckoutSessionIntoDb,
};
export default PaymentService;
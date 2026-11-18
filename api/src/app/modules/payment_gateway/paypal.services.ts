import axios from "axios";
import { status } from "http-status";
import { Types } from "mongoose";
import config from "../../config";
import AppError from "../../errors/AppError";
import generatePaypalAccessToken from "../../utils/generatePaypalAccessToken";
import events from "../event/event.model";
import NotificationServices from "../notification/notification.services";
import { NotificationType } from "../notification/notification.constant";
import paymentgateways from "./payment_gateway.model";
import { payment_method, payment_status } from "./payment_gateway.constant";

/**
 * PayPal ticket purchases.
 *
 * Flow:
 *  1. App: POST /payment/payment_onboarding { eventId, ticketCount } -> { orderId, approvalUrl }
 *     The price is taken from the event (never from the app). An unpaid payment record is saved.
 *  2. User approves on PayPal -> PayPal redirects to GET /payment/complete-order?token=<orderId>
 *     The order is captured and the payment record marked paid (ticket shows in history).
 *  3. App (optional, recommended): GET /payment/verify/:orderId -> { isPaid, payment }
 *
 * If the redirect never reaches us (user closed the browser), ticket/event history and the
 * unpaid-payment cleanup capture approved orders too, so a paid ticket is never lost.
 */

const SUPPORTED_CURRENCY = "USD";
const MAX_TICKETS = 20;

const paypalBaseUrl = () => {
  const baseUrl = config.payment_getway_credentials?.paypal_base_url;
  if (!baseUrl) {
    throw new AppError(status.SERVICE_UNAVAILABLE, "PayPal is not configured", "");
  }
  return String(baseUrl).trim().replace(/\/+$/, "");
};

/** Public URL of this API, used for PayPal's return/cancel redirects. */
export const publicApiUrl = () =>
  String(config.public_api_url || config.payment_getway_credentials?.frontend_url || "")
    .trim()
    .replace(/\/+$/, "");

export const paypalSessionId = (orderId: string) => `paypal_${orderId}`;

const paypalRequest = async <T = any>(
  method: "get" | "post",
  path: string,
  body?: unknown
): Promise<T> => {
  const { access_token } = await generatePaypalAccessToken();
  const response = await axios.request<T>({
    method,
    url: `${paypalBaseUrl()}${path}`,
    data: body,
    timeout: 20000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access_token}`,
    },
  });
  return response.data;
};

const paypalErrorMessage = (error: any, fallback: string) =>
  error?.response?.data?.details?.[0]?.description ||
  error?.response?.data?.message ||
  error?.message ||
  fallback;

const toCents = (value: unknown) => Math.round(Number(value) * 100);

// ----------------------------------------------------------------------------
// 1) Create the PayPal order for an event ticket
// ----------------------------------------------------------------------------

const createPaypalTicketOrder = async (
  userId: string,
  payload: { eventId?: string; ticketCount?: number; currency?: string }
) => {
  const { eventId } = payload;
  const ticketCount = payload.ticketCount === undefined ? 1 : Number(payload.ticketCount);
  const currency = String(payload.currency || SUPPORTED_CURRENCY).toUpperCase();

  if (!eventId || !Types.ObjectId.isValid(eventId)) {
    throw new AppError(status.BAD_REQUEST, "A valid eventId is required", "");
  }
  if (!Number.isInteger(ticketCount) || ticketCount < 1 || ticketCount > MAX_TICKETS) {
    throw new AppError(
      status.BAD_REQUEST,
      `Ticket count must be a whole number between 1 and ${MAX_TICKETS}`,
      ""
    );
  }
  if (currency !== SUPPORTED_CURRENCY) {
    throw new AppError(status.BAD_REQUEST, `Only ${SUPPORTED_CURRENCY} payments are supported`, "");
  }

  const event: any = await events
    .findOne({ _id: eventId })
    .select("event_title ending_time audience_settings.ticket_price audience_settings.price")
    .lean();

  if (!event) {
    throw new AppError(status.NOT_FOUND, "Event not found", "");
  }
  if (event.ending_time && new Date(event.ending_time).getTime() < Date.now()) {
    throw new AppError(status.BAD_REQUEST, "This event has already ended", "");
  }
  const unitPrice = Number(event.audience_settings?.price);
  if (event.audience_settings?.ticket_price !== "paid" || !(unitPrice > 0)) {
    throw new AppError(status.BAD_REQUEST, "This event is free. No payment is needed", "");
  }

  const total = (toCents(unitPrice) * ticketCount) / 100;
  const value = total.toFixed(2);
  const apiUrl = publicApiUrl();
  if (!apiUrl) {
    throw new AppError(status.SERVICE_UNAVAILABLE, "PUBLIC_API_URL is not configured", "");
  }

  const itemName = String(event.event_title || "Event ticket").slice(0, 120);

  let order: any;
  try {
    order = await paypalRequest("post", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: String(eventId),
          // lets us rebuild the payment record from PayPal if it goes missing
          custom_id: `${userId}:${eventId}:${ticketCount}`,
          description: `${ticketCount} ticket(s) for ${itemName}`.slice(0, 127),
          items: [
            {
              name: itemName,
              description: "Event ticket",
              quantity: String(ticketCount),
              unit_amount: { currency_code: currency, value: unitPrice.toFixed(2) },
              category: "DIGITAL_GOODS",
            },
          ],
          amount: {
            currency_code: currency,
            value,
            breakdown: { item_total: { currency_code: currency, value } },
          },
        },
      ],
      application_context: {
        brand_name: "Thrillio",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: `${apiUrl}/api/v1/payment/complete-order`,
        cancel_url: `${apiUrl}/api/v1/payment/cancel-order`,
      },
    });
  } catch (error: any) {
    console.error("PayPal create order error:", error?.response?.data || error?.message);
    throw new AppError(
      status.BAD_GATEWAY,
      `PayPal: ${paypalErrorMessage(error, "Failed to create PayPal order")}`,
      ""
    );
  }

  const payment = await paymentgateways.create({
    userId,
    eventId,
    ticketCount,
    price: total,
    currency: currency.toLowerCase(),
    description: "ticket payment",
    sessionId: paypalSessionId(order.id),
    paypalOrderId: order.id,
    paymentmethod: payment_method.paypal,
    payment_status: payment_status.unpaid,
  });

  const approvalUrl = order.links?.find((link: any) => link.rel === "approve")?.href;

  return {
    orderId: order.id as string,
    status: order.status as string,
    approvalUrl,
    amount: total,
    currency,
    ticketCount,
    paymentId: payment._id,
  };
};

// ----------------------------------------------------------------------------
// 2) Bring our payment record in line with the PayPal order (capturing if approved)
// ----------------------------------------------------------------------------

const syncPaypalOrder = async (orderId: string, options: { capture?: boolean } = {}) => {
  if (!orderId || !/^[A-Z0-9]{5,40}$/i.test(orderId)) {
    throw new AppError(status.BAD_REQUEST, "Invalid PayPal order id", "");
  }

  let order: any;
  try {
    order = await paypalRequest("get", `/v2/checkout/orders/${orderId}`);
  } catch (error: any) {
    if (error?.response?.status === 404) {
      throw new AppError(status.NOT_FOUND, "PayPal order not found", "");
    }
    throw new AppError(
      status.BAD_GATEWAY,
      `PayPal: ${paypalErrorMessage(error, "Could not check the PayPal order")}`,
      ""
    );
  }

  if (order.status === "APPROVED" && options.capture !== false) {
    try {
      order = await paypalRequest("post", `/v2/checkout/orders/${orderId}/capture`, {});
    } catch (error: any) {
      const issue = error?.response?.data?.details?.[0]?.issue;
      if (issue === "ORDER_ALREADY_CAPTURED") {
        order = await paypalRequest("get", `/v2/checkout/orders/${orderId}`);
      } else {
        console.error("PayPal capture error:", error?.response?.data || error?.message);
        throw new AppError(
          status.BAD_GATEWAY,
          `PayPal: ${paypalErrorMessage(error, "Could not capture the PayPal payment")}`,
          ""
        );
      }
    }
  }

  let payment: any = await paymentgateways.findOne({ paypalOrderId: orderId });

  const unit = order.purchase_units?.[0] || {};
  const capture = unit.payments?.captures?.[0];
  const isCompleted = order.status === "COMPLETED" && capture?.status === "COMPLETED";

  if (!isCompleted) {
    return { isPaid: false, paypalStatus: order.status as string, payment };
  }

  // Rebuild a missing record (e.g. removed by the unpaid cleanup) from the order itself
  if (!payment) {
    const [userId, eventId, count] = String(unit.custom_id || "").split(":");
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(eventId)) {
      throw new AppError(status.BAD_REQUEST, "PayPal order is not linked to a ticket", "");
    }
    payment = await paymentgateways.create({
      userId,
      eventId,
      ticketCount: Number(count) || 1,
      price: Number(capture.amount?.value) || 0,
      currency: String(capture.amount?.currency_code || SUPPORTED_CURRENCY).toLowerCase(),
      description: "ticket payment",
      sessionId: paypalSessionId(orderId),
      paypalOrderId: orderId,
      paymentmethod: payment_method.paypal,
      payment_status: payment_status.unpaid,
    });
  }

  // The captured amount must match what we asked for
  if (
    toCents(capture.amount?.value) !== toCents(payment.price) ||
    String(capture.amount?.currency_code || "").toLowerCase() !==
      String(payment.currency || SUPPORTED_CURRENCY).toLowerCase()
  ) {
    console.error(
      `PayPal amount mismatch for order ${orderId}: captured ${capture.amount?.value} ${capture.amount?.currency_code}, expected ${payment.price} ${payment.currency}`
    );
    throw new AppError(status.CONFLICT, "Paid amount does not match the ticket price", "");
  }

  const payer = order.payer || {};
  const updated = await paymentgateways.findOneAndUpdate(
    { _id: payment._id, payment_status: { $ne: payment_status.paid } },
    {
      $set: {
        payment_status: payment_status.paid,
        payment_intent: capture.id,
        payable_email: payer.email_address || "",
        payable_name: [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(" "),
        country: payer.address?.country_code || "",
      },
    },
    { new: true }
  );

  if (updated) {
    payment = updated;
    try {
      await NotificationServices.createAndSendNotification({
        userId: new Types.ObjectId(String(payment.userId)),
        title: "Ticket Payment",
        content: "Payment completed successfully.",
        type: NotificationType.payment,
        eventId: new Types.ObjectId(String(payment.eventId)),
      });
    } catch (notifyError: any) {
      console.error("Payment notification failed:", notifyError?.message || notifyError);
    }
  } else {
    payment = await paymentgateways.findById(payment._id);
  }

  return { isPaid: true, paypalStatus: order.status as string, payment };
};

// ----------------------------------------------------------------------------
// 3) App check after the PayPal screen closes
// ----------------------------------------------------------------------------

const verifyPaypalTicketOrder = async (userId: string, orderId: string) => {
  const own = await paymentgateways
    .findOne({ paypalOrderId: orderId })
    .select("userId")
    .lean();
  if (own && String(own.userId) !== String(userId)) {
    throw new AppError(status.FORBIDDEN, "This payment does not belong to you", "");
  }

  const result = await syncPaypalOrder(orderId, { capture: true });
  if (result.payment && String(result.payment.userId) !== String(userId)) {
    throw new AppError(status.FORBIDDEN, "This payment does not belong to you", "");
  }
  return result;
};

const PaypalServices = {
  createPaypalTicketOrder,
  syncPaypalOrder,
  verifyPaypalTicketOrder,
};

export default PaypalServices;

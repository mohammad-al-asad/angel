import { status } from 'http-status';
import AppError from "../errors/AppError";
import { payment_status } from "../modules/payment_gateway/payment_gateway.constant";
import paymentgateways from "../modules/payment_gateway/payment_gateway.model";
import PaymentService from "../modules/payment_gateway/payment_gateway.services";

/**
 * Removes abandoned checkouts (unpaid for more than 30 minutes).
 *
 * Before deleting, each Stripe checkout is checked with Stripe: if it was actually paid
 * (e.g. the webhook never arrived or failed) it is recorded as paid instead of deleted.
 * If Stripe can't be reached, the record is kept and retried on the next run.
 */
const handle_unpaid_payment = async () => {
  try {
    const timeThreshold = new Date(Date.now() - 30 * 60 * 1000);

    const candidates = await paymentgateways
      .find({
        payment_status: payment_status.unpaid,
        isDelete: false,
        createdAt: { $lt: timeThreshold },
      })
      .select('_id sessionId')
      .lean();

    if (!candidates.length) {
      return { deletedCount: 0, recoveredCount: 0, message: 'No unpaid payments to delete' };
    }

    const toDelete: unknown[] = [];
    let recoveredCount = 0;

    for (const payment of candidates) {
      if (!payment.sessionId) {
        toDelete.push(payment._id); // not a Stripe checkout, nothing to verify
        continue;
      }
      try {
        const result = await PaymentService.syncCheckoutSessionPayment(payment.sessionId as string);
        if (result.isPaid) {
          recoveredCount++;
        } else {
          toDelete.push(payment._id);
        }
      } catch (error: any) {
        console.error(`Unpaid cleanup: could not verify checkout ${payment.sessionId}, keeping it:`, error?.message || error);
      }
    }

    const deleteResult = toDelete.length
      ? await paymentgateways.deleteMany({ _id: { $in: toDelete } })
      : { deletedCount: 0 };

    console.log(`Unpaid cleanup: deleted ${deleteResult.deletedCount}, recovered ${recoveredCount} paid checkouts`);

    return {
      deletedCount: deleteResult.deletedCount,
      recoveredCount,
      message: `Deleted ${deleteResult.deletedCount} unpaid payments, recovered ${recoveredCount}`,
    };
  } catch (error: any) {
    throw new AppError(
      status.INTERNAL_SERVER_ERROR,
      'unpaid payment cron under issues',
      error,
    );
  }
};

export default handle_unpaid_payment;

import { Router, Request, Response } from 'express';
import { requireUser, requireAdmin, getAuthUser } from './firebaseAuth';
import {
  YieldPoolError,
  adminCompleteWithdrawal,
  adminGetOverview,
  adminManualCreditAllocation,
  adminRejectWithdrawal,
  getClientSummary,
  requestYieldWithdrawal,
  runDailyPayoutSweep,
  verifyAndAllocate,
} from './yieldPoolService';

export const yieldPoolRouter = Router();

function fail(res: Response, e: any, label: string) {
  if (e instanceof YieldPoolError) return res.status(e.status).json({ success: false, error: e.message });
  console.error(`❌ [API ${label}]`, e?.message || e);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
}

yieldPoolRouter.get('/summary', requireUser, async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, ...(await getClientSummary(getAuthUser(req).uid)) });
  } catch (e) {
    return fail(res, e, '/yield-pool/summary');
  }
});

yieldPoolRouter.post('/allocate', requireUser, async (req: Request, res: Response) => {
  try {
    const out = await verifyAndAllocate(getAuthUser(req).uid, req.body?.amountUsdt, req.body?.txHash);
    return res.status(200).json({ success: true, ...out });
  } catch (e) {
    return fail(res, e, '/yield-pool/allocate');
  }
});

yieldPoolRouter.post('/withdraw', requireUser, async (req: Request, res: Response) => {
  try {
    const out = await requestYieldWithdrawal(
      getAuthUser(req).uid,
      req.body?.amountUsdt,
      req.body?.destinationAddress
    );
    return res.status(200).json({ success: true, ...out });
  } catch (e) {
    return fail(res, e, '/yield-pool/withdraw');
  }
});

// ---------- Administrators ----------

yieldPoolRouter.get('/admin/overview', requireAdmin, async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, ...(await adminGetOverview()) });
  } catch (e) {
    return fail(res, e, '/yield-pool/admin/overview');
  }
});

yieldPoolRouter.post('/admin/run-payout', requireAdmin, async (req: Request, res: Response) => {
  try {
    const dateKey = typeof req.body?.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dateKey)
      ? req.body.dateKey
      : undefined;
    const out = await runDailyPayoutSweep({ dateKey });
    return res.status(200).json({ success: true, ...out });
  } catch (e) {
    return fail(res, e, '/yield-pool/admin/run-payout');
  }
});

yieldPoolRouter.post('/admin/credit-allocation', requireAdmin, async (req: Request, res: Response) => {
  try {
    const out = await adminManualCreditAllocation(getAuthUser(req).uid, {
      userId: String(req.body?.userId || ''),
      amountUsdt: Number(req.body?.amountUsdt),
      txHash: req.body?.txHash,
      note: req.body?.note,
    });
    return res.status(200).json({ success: true, ...out });
  } catch (e) {
    return fail(res, e, '/yield-pool/admin/credit-allocation');
  }
});

yieldPoolRouter.post('/admin/withdrawals/:id/complete', requireAdmin, async (req: Request, res: Response) => {
  try {
    const withdrawal = await adminCompleteWithdrawal(
      getAuthUser(req).uid,
      String(req.params.id),
      req.body?.txHash
    );
    return res.status(200).json({ success: true, withdrawal });
  } catch (e) {
    return fail(res, e, '/yield-pool/admin/withdrawals/complete');
  }
});

yieldPoolRouter.post('/admin/withdrawals/:id/reject', requireAdmin, async (req: Request, res: Response) => {
  try {
    const withdrawal = await adminRejectWithdrawal(
      getAuthUser(req).uid,
      String(req.params.id),
      req.body?.reason
    );
    return res.status(200).json({ success: true, withdrawal });
  } catch (e) {
    return fail(res, e, '/yield-pool/admin/withdrawals/reject');
  }
});

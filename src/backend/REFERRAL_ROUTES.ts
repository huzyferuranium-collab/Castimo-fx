import { Router, Request, Response } from 'express';
import { requireUser, requireAdmin, getAuthUser } from './firebaseAuth';
import {
  ReferralError,
  adminComplete,
  adminListWithdrawals,
  adminSetStatus,
  attachReferrer,
  notificationsFor,
  requestWithdrawal,
  summary,
} from './referralService';

export const referralRouter = Router();

function fail(res: Response, e: any, label: string) {
  if (e instanceof ReferralError) return res.status(e.status).json({ success: false, error: e.message });
  console.error(`❌ [API ${label}]`, e?.message || e);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
}

referralRouter.get('/summary', requireUser, async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, ...(await summary(getAuthUser(req).uid)) });
  } catch (e) {
    return fail(res, e, '/referrals/summary');
  }
});

referralRouter.post('/attach', requireUser, async (req: Request, res: Response) => {
  try {
    await attachReferrer(getAuthUser(req).uid, req.body?.code);
    return res.status(200).json({ success: true });
  } catch (e) {
    return fail(res, e, '/referrals/attach');
  }
});

referralRouter.post('/withdraw', requireUser, async (req: Request, res: Response) => {
  try {
    const withdrawal = await requestWithdrawal(getAuthUser(req).uid, req.body?.amount, req.body?.wallet);
    return res.status(200).json({ success: true, withdrawal });
  } catch (e) {
    return fail(res, e, '/referrals/withdraw');
  }
});

referralRouter.get('/notifications', requireUser, async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, ...(await notificationsFor(getAuthUser(req).uid)) });
  } catch (e) {
    return fail(res, e, '/referrals/notifications');
  }
});

referralRouter.get('/admin/withdrawals', requireAdmin, async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, withdrawals: await adminListWithdrawals() });
  } catch (e) {
    return fail(res, e, '/referrals/admin/withdrawals');
  }
});

referralRouter.post('/admin/withdrawals/:id/status', requireAdmin, async (req: Request, res: Response) => {
  try {
    const w = await adminSetStatus(getAuthUser(req).uid, String(req.params.id), req.body?.status, req.body?.reason);
    return res.status(200).json({ success: true, withdrawal: w });
  } catch (e) {
    return fail(res, e, '/referrals/admin/status');
  }
});

referralRouter.post('/admin/withdrawals/:id/complete', requireAdmin, async (req: Request, res: Response) => {
  try {
    const w = await adminComplete(getAuthUser(req).uid, String(req.params.id), req.body?.txHash);
    return res.status(200).json({ success: true, withdrawal: w });
  } catch (e) {
    return fail(res, e, '/referrals/admin/complete');
  }
});

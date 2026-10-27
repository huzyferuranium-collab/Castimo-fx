import { Router, Request, Response } from 'express';
import { requireUser, getAuthUser } from './firebaseAuth';
import { PhoneError, startVerification, checkVerification, getPhoneStatus, phoneVerificationConfigured } from './phoneVerification';

export const phoneRouter = Router();

function fail(res: Response, e: any) {
  if (e instanceof PhoneError) return res.status(e.status).json({ success: false, code: e.code, error: e.message });
  console.error('❌ [API /api/phone] Unexpected error:', e?.message || e);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
}

/** GET /api/phone/status */
phoneRouter.get('/status', requireUser, async (req: Request, res: Response) => {
  try {
    if (!phoneVerificationConfigured()) {
      return res.status(200).json({ success: true, available: false, verified: false });
    }
    const s = await getPhoneStatus(getAuthUser(req).uid);
    return res.status(200).json({ success: true, available: true, ...s });
  } catch (e) {
    return fail(res, e);
  }
});

/** POST /api/phone/send  { phone } */
phoneRouter.post('/send', requireUser, async (req: Request, res: Response) => {
  try {
    await startVerification(getAuthUser(req).uid, req.body?.phone);
    return res.status(200).json({ success: true, message: 'Code sent on WhatsApp.' });
  } catch (e) {
    return fail(res, e);
  }
});

/** POST /api/phone/verify  { phone, code } */
phoneRouter.post('/verify', requireUser, async (req: Request, res: Response) => {
  try {
    const r = await checkVerification(getAuthUser(req).uid, req.body?.phone, req.body?.code);
    return res.status(200).json({ success: true, ...r });
  } catch (e) {
    return fail(res, e);
  }
});

import { Router, Request, Response } from 'express';
import { requireUser, getAuthUser } from './firebaseAuth';
import { EmailCodeError, emailCodeConfigured, sendCode, verifyCode } from './emailCodeService';

export const emailCodeRouter = Router();

function fail(res: Response, e: any, label: string) {
  if (e instanceof EmailCodeError) return res.status(e.status).json({ success: false, error: e.message });
  console.error(`❌ [API ${label}]`, e?.message || e);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
}

/** Whether email codes can be used at all (so the page can offer the link instead). */
emailCodeRouter.get('/status', requireUser, (_req: Request, res: Response) => {
  res.status(200).json({ success: true, available: emailCodeConfigured() });
});

emailCodeRouter.post('/send', requireUser, async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, ...(await sendCode(getAuthUser(req))) });
  } catch (e) {
    return fail(res, e, '/email-code/send');
  }
});

emailCodeRouter.post('/verify', requireUser, async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, ...(await verifyCode(getAuthUser(req), req.body?.code)) });
  } catch (e) {
    return fail(res, e, '/email-code/verify');
  }
});

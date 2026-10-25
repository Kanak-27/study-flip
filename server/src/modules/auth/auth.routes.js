import { Router } from 'express';
import { User } from './user.model.js';
import { registerSchema, loginSchema, registerUser, authenticate, parse } from './auth.service.js';
import { wrap, unauthorized } from '../../platform/errors.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  wrap(async (req, res) => {
    const data = parse(registerSchema, req.body);
    const user = await registerUser(data);
    req.session.userId = user.id;
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const data = parse(loginSchema, req.body);
    const user = await authenticate(data);
    req.session.userId = user.id;
    res.json({ user });
  }),
);

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('studyflip.sid').json({ ok: true });
  });
});

authRouter.get(
  '/me',
  wrap(async (req, res) => {
    if (!req.session.userId) throw unauthorized();
    const user = await User.findById(req.session.userId);
    if (!user) {
      // session outlived the account
      req.session.destroy(() => {});
      throw unauthorized();
    }
    res.json({ user });
  }),
);

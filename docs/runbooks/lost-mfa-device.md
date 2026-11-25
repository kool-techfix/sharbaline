# Runbook: staff member lost their phone or authenticator

1. **Can they sign in with a recovery code?** On the code screen, choose "Use a recovery code". Each of their 8 codes works once.
2. **No codes left, or codes lost:** an administrator resets their authenticator: **Users → the person → Account actions → Reset authenticator → Confirm** (`users.reset_mfa`). This:
   - revokes the old authenticator and all unused recovery codes
   - signs the person out everywhere
   - makes them set up a new authenticator at their next sign-in (doctor, pharmacist, admin)
3. **Check the person's identity in person** before resetting. A reset request is a classic social-engineering route.
4. **If the lost phone could be in someone else's hands,** also choose **Issue temporary password** on the same page (`users.issue_temporary_password`), so both factors are replaced. The password is shown once: hand it over in person.
5. **The administrator lost their own phone:** another administrator resets it (admins can't reset their own). If there is no other admin, our support engineer follows `admin-bootstrap.md` with the hospital's written approval.

All of these actions are recorded in the audit log.

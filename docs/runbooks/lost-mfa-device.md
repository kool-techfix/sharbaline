# Runbook: staff member lost their phone or authenticator

1. **Can they sign in with a recovery code?** On the code screen, choose "Use a recovery code". Each of their 8 codes works once.
2. **No codes left, or codes lost:** an administrator resets their authenticator: **Users → the person → Account actions → Reset authenticator → Confirm** (`users.reset_mfa`). This:
   - revokes the old authenticator and all unused recovery codes
   - signs the person out everywhere
   - makes them set up a new authenticator at their next sign-in (doctor, pharmacist, admin)
3. **Check the person's identity in person** before resetting. A reset request is a classic social-engineering route.
4. **If the lost phone could be in someone else's hands,** also choose **Issue temporary password** on the same page (`users.issue_temporary_password`), so both factors are replaced. The password is shown once: hand it over in person.
5. **An administrator lost their own phone:** another administrator resets it in the app (admins can't reset their own).
6. **The ONLY active administrator lost their phone (or password):** a last resort at the server console.
   1. Get the hospital's **written approval** (who asked, who approved, date) and keep it with the support records.
   2. Our support engineer, at the server console or over the support VPN, runs:
      ```
      pnpm admin:recover --staff-id <their staff id>
      ```
      It refuses if any other active administrator exists. In that case use step 5 instead.
   3. The command revokes their authenticator and recovery codes, ends their sessions, lifts any lockout, and prints a **temporary password once**.
   4. **Check the administrator's identity in person**, then hand the password over. Never send it by SMS, WhatsApp or email.
   5. At sign-in they choose a new password, then set up a new authenticator and save the new recovery codes.
   6. They then **create a second administrator straight away**, so this isn't needed again.

All of these actions are recorded in the audit log.

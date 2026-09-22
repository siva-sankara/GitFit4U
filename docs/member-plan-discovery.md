# Member plans and gym login routing

Owners configure memberships under **Owner dashboard → Gym profile → Memberships → Add membership plan**, or the existing **Membership plans** screen. Enter the name, unique plan code, duration, price in rupees, benefits, and status. Select **Active** to publish. Draft and inactive plans remain hidden from members.

Gym registration/platform plans pay for the owner's platform subscription. They are separate from the member plans sold by that gym. Existing gyms without member plans need their owner to enter real prices and publish a plan; no prices are generated and no existing drafts are automatically published.

The existing owner plan APIs create/update database records and refresh gym listing prices. The gym details API returns only active memberships belonging to that gym. No database migration or new environment variables are required.

Visitors selecting a gym from landing/search are asked to sign in before viewing its profile. Existing sessions are restored where possible. The login URL retains a validated local `returnTo` destination across signup, phone OTP, password recovery, and page reloads. Authentication returns to the exact gym rather than restarting discovery. A `plan` query parameter restores an available membership into checkout for review; it never automatically starts a Razorpay payment. Removed plans display a message and allow another selection.

Verification:

- Frontend: `npm test` and `npm run build` from `frontend`.
- Backend: `npm run test:gym-profile` from `backend` uses a unique temporary database and removes it afterward. Checks include draft/active/inactive visibility, correct gym and price, and rejection of cross-tenant updates. Cloud storage is simulated by this test.
- Real Razorpay payments still require the existing payment configuration; routing tests do not charge users.


## Profile visibility and completed member checkout

The member profile places membership cards before the overview, refreshes its API data on return/focus and every 30 seconds, and offers **Subscribe & join**. Backend-confirmed capture now automatically refreshes membership data and takes the member to their subscriptions with a welcome message. A frontend gateway callback alone never enrolls a member.

The owner profile identifies the selected gym and shows a visibility notice when its gym status or platform subscription is not active. Member plans belong to that selected gym only. A legacy gym with `status: ACTIVE` but `platformSubscriptionStatus: NONE` remains hidden from public discovery and checkout; a legacy registration marked active is not evidence of payment. No plans are transferred between gyms and no unpaid records are activated.

`npm run test:integration` now also checks a first-time member joining through simulated gateway verification: invalid signature, failed payment, order reuse on retry, verified enrollment, duplicate callbacks, one invoice, and visibility in owner/member lists. It verifies that an unpaid platform subscription blocks public checkout. Run from `backend`; the database is isolated and removed afterward.

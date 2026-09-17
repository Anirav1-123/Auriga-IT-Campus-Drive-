# 🧠 TiffinTrack — Reasoning & Design Decisions

## 1. Project Goal

TiffinTrack is designed for a small home-style tiffin delivery business.

The main goal is to reduce manual work involved in:

- Managing customers
- Managing monthly subscriptions
- Pausing and resuming service
- Tracking delivery days
- Calculating prorated bills
- Recording payments
- Sending delivery notifications
- Transferring subscriptions
- Importing messy customer data

The system focuses on the customer's subscription lifecycle and the owner's daily operations.

---

# 2. Core Business Logic

## Customer

A customer contains:

- Name
- Phone number
- Address
- Monthly plan price
- Active/paused status

Phone numbers are used as an important lookup and deduplication key.

---

## Subscription

Each customer can have a monthly subscription.

A subscription stores:

- Customer
- Monthly price
- Cycle start date
- Cycle end date
- Subscription status

Keeping subscription information separately allows the system to track the lifecycle of a customer's plan.

---

# 3. Pause & Resume Reasoning

Customers may temporarily stop their tiffin service because of:

- Travel
- Festivals
- Personal reasons

Instead of cancelling the subscription permanently, the system keeps the subscription and changes the service state.

Paused days should not count as delivered service.

This is important because the final monthly bill depends on the number of days for which the customer actually received service.

---

# 4. Service Day Tracking

Service days are tracked separately from the customer and subscription.

A service day can represent whether lunch was:

- Served
- Paused

Weekends are not treated as normal delivery days because the business provides lunch on weekdays.

This makes it possible to calculate actual served days instead of simply charging a fixed monthly amount.

---

# 5. Prorated Billing

The billing logic is based on service days.

Conceptually:

```text
Daily Rate = Monthly Plan Price / Total Weekdays in Cycle

Bill = Daily Rate × Actual Served Days

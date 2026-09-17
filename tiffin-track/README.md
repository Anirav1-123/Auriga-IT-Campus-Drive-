# 🍱 TiffinTrack

TiffinTrack is a simple home-style tiffin subscription management system built for small lunch/tiffin delivery businesses.

It helps the owner manage customers, monthly subscriptions, pauses/resumes, deliveries, prorated billing, subscription transfers, customer imports, and delivery notifications from one dashboard.

---

## 🎯 Problem Statement

Home-style tiffin businesses often manage monthly subscribers using notebooks, spreadsheets, or manual calculations.

This creates problems such as:

- Tracking active and paused customers
- Remembering which customers need delivery
- Calculating bills when customers pause service
- Managing customer information
- Handling subscription changes
- Sending delivery reminders
- Importing customer data from messy files

TiffinTrack provides a centralized system to manage these operations digitally.

---

## 🚀 Key Features

### Customer Management
- Add new customers
- Store customer name, phone and address
- Search customers by name or phone
- Filter customers by active/paused status
- View customer details

### Subscription Management
- Create monthly tiffin subscriptions
- Store monthly plan price
- Track subscription status
- Track subscription cycle

### Pause & Resume
Customers can pause their tiffin service for:
- Travel
- Festivals
- Personal reasons

Paused days are not counted as delivered service.

### 📊 Prorated Billing
Monthly billing is calculated according to the number of service days actually delivered.

The system accounts for:
- Weekdays
- Paused days
- Subscription cycle
- Monthly plan price

---

# 🧩 Builder Challenge Features

## Level 1 — T1: Delivery Notifications

Each morning, TiffinTrack identifies customers who are due for delivery.

A customer is considered due when:

- The subscription is active
- The date is a weekday
- The customer is not paused

The Notification Service creates a notification in the notification outbox.

### Trigger

```http
POST /clock
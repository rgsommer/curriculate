/signup Route (Important Note)
⚠️ This is not a real signup/authentication page.
The /signup route currently exists as a compatibility redirect used by:
Stripe success / cancel flows
Checkout error handling (returnTo, handoff, etc.)
Legacy and future links that assume /signup exists
What it does now
Preserves query parameters
Redirects users to /pricing
Why it exists
Prevents 404s from Stripe and internal redirects
Allows the marketing site to function before a full auth system is in place
Keeps URLs stable so real signup/auth can be added later without breaking links
Future plan
Replace this redirect with a real signup / login flow
Keep the /signup path to avoid breaking existing integrations
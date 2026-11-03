/* ============================================================================
   paywall.js — the one switch for charging.

     false   free: no demo clock, no locks, no key wall, nothing on sale
     true    paid: the $19 licence, exactly as described in SELLING.md

   Flipping it needs nothing else. license.js goes dormant when this is false
   and gate.js follows it; the licence Worker, Stripe, and every key already on
   a customer's device are left alone, so turning it back on picks up where it
   stopped. A customer's key is still in their browser and re-verifies by itself.

   Loaded without a ?v= on purpose, and before license.js on every page that
   sells or checks a licence, so a flip does not mean editing twenty-odd tags.
   Anything other than an explicit false means the paywall is on: a page that
   somehow misses this file charges, rather than giving the product away.
   ============================================================================ */
window.TB_PAYWALL = false;

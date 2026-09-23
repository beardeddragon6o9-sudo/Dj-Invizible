# DJ Doom knowledge base: what to ask DJ Invizible

All customer-facing facts and both AI personalities are configured in
[`api/_lib/artistInfo.js`](api/_lib/artistInfo.js).

**Do not fill unconfirmed fields with sample prices, invented services, or
made-up social links.** A `null` field means “ask DJ Invizible”; the live
assistant will offer to collect event details instead of making something up.

## Interview checklist

### Artist details
- Preferred short bio and accomplishments he wants mentioned publicly
- Genres and specialties for DJ Invizible, and separately for Midnight Maverick
- Types of events actually offered (weddings, private events, clubs, rodeos, etc.)
- Approved public mixes, social-media and upcoming-show links
- Where he is based and where he is willing to travel

### Pricing and booking terms
- Night block and daytime pricing, or whether all quotes are custom
- Hourly pricing (if any), minimum charge, additional hours and overtime
- Whether pricing includes equipment, sound, lighting, travel and setup
- Deposit or retainer amount, payment deadlines and accepted methods
- Cancellation/rescheduling rules and lead-time requirements
- How DJ wants to handle weddings, unusual venues, travel and long events
- Public contact email/phone, if he wants either displayed by the assistant

## Updating facts

1. Open `api/_lib/artistInfo.js` in GitHub.
2. Replace `null` ONLY for details DJ has approved. Use real URLs and actual
   CAD figures, or a confirmed “custom quote” explanation when appropriate.
3. Edit the `siteDescription` text if DJ wants different positioning.
4. Merge the change and let Vercel deploy. The AI reads the updated profile
   without needing a new prompt redesign.

For example, if he confirms equipment details, replace
`equipmentIncluded: null` with a specific confirmed description of what
is and isn't included. Do not enter a generic “professional sound and lights”
unless he has verified it.

The `bookingPolicy` and day/night time blocks describe how THIS website
works. Do not change them casually to mimic an artist's public price list.

## Customer experience until the interview is complete

- “How much?” → No invented number; offer event-specific pricing inquiry.
- “Do you do weddings?” → Avoid promising an unverified service; offer to
  pass a detailed request to the DJ.
- “Got a mix link?” → Don't make up a link; explain it isn't listed yet.
- “Are you free October 10, 9 PM to 1 AM?” → Check actual Cal.com availability.
- “Send my booking request” → Actually save the request and return its ID.
- Switching mascots → Changes conversation style and records the selected
  stage act in the owner inbox, without mixing the two conversation histories.

The site still requires a customer email before the owner can make an
official Cal.com reservation; phone-only contact works for the initial
screening request.

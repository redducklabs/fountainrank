# FountainRank Design Plan And Approach

## Product Direction

FountainRank should feel like a practical civic map with a light layer of achievement. The main experience is not a game screen; it is a useful map that makes participation feel rewarding because the user's actions visibly improve public information.

The design should support three user mindsets:

- I need water nearby right now.
- I found a fountain and want to share it.
- I want to help map my neighborhood, city, campus, park, or route.

## Design Principles

- Map first: the primary screen should always make it easy to find nearby fountains.
- Contribution in context: prompts to add, rate, verify, or photograph should appear when they are relevant to what the user is viewing.
- Quality over quantity: rewards should favor verified, useful contributions instead of raw activity.
- Early progress matters: sparse areas should feel like an invitation to help, not an empty product.
- Trust stays visible: show when data was last verified, how many people rated it, and whether details are community-submitted.

## Core Experience

### Home Map

The home screen should open directly to the map. Users should immediately see:

- Nearby fountain pins
- Working or broken status
- Rating summary where available
- A clear add button
- A lightweight prompt when an area needs contributions

When an area has few fountains, the empty state should be constructive:

- "No fountains mapped here yet"
- "Be the first to add one nearby"
- "Help start this neighborhood"

### Fountain Detail

The fountain detail view should answer practical questions quickly:

- Is it working?
- How good is it?
- How many people rated it?
- When was it last verified?
- What do people say about taste, pressure, clarity, and appearance?
- Are there photos?

The detail view should include direct contribution actions:

- Rate this fountain
- Confirm it is working
- Report an issue
- Add a photo
- Suggest an edit

### Add Fountain Flow

The add flow should be short and location-aware:

1. Confirm location from GPS or map pin.
2. Mark working status.
3. Add ratings if the user used it.
4. Add optional comment and photo.
5. Submit and show immediate contribution feedback.

The flow should check for nearby duplicates before final submission and explain possible duplicates clearly.

### Rating Flow

Ratings should use four simple dimensions:

- Clarity
- Taste
- Pressure
- Appearance

Each should be quick to score, with optional comments kept secondary. The user should be able to submit partial ratings if they cannot judge every dimension, but complete ratings can earn a small completion bonus.

## Gamification Layer

The gamification layer should be present but restrained. It should encourage civic contribution without making the product feel unserious.

### Points

Points should be attached to useful map improvements:

- New fountain
- First fountain in an unmapped area
- First rating on a fountain
- Verification of stale fountain data
- Useful photo
- Accepted correction or report

Points should appear immediately after contribution, then roll into profile progress.

### Badges

Badges should communicate identity and milestones:

- Founding Scout
- Neighborhood Founder
- Field Verifier
- Photo Proof
- Pressure Tester
- Trail Mapper
- Campus Mapper

Early badges should be limited and persistent so initial users get lasting recognition.

### Local Progress

Local progress should make early participation tangible:

- Neighborhood coverage
- Fountains needing first ratings
- Fountains needing verification
- Recently improved areas

This should be more prominent than global ranking during early launch.

### Leaderboards

Leaderboards should start local:

- Nearby top contributors
- Most helpful this month
- Most verified fountains
- Most new areas mapped

Global leaderboards can exist later, but they should not dominate the early experience.

## Early Launch Approach

The initial challenge is that the map may be sparse. The design should turn that into a clear mission:

- "Start your area"
- "Add the first fountain here"
- "Help verify this park"
- "This fountain needs its first rating"

Early users should see that they are building the foundation of the map. The app should show their impact in profile stats, map callouts, and founder badges.

## Trust And Safety

Because the app depends on public community data, the design needs guardrails:

- Show community-submitted status clearly.
- Show last verified date where available.
- Let users report duplicates, bad data, unsafe locations, and broken fountains.
- Avoid promising water safety, availability, or accessibility.
- Require proximity or recent location for verification-style rewards.
- Let moderation hide problematic photos or listings.

## Visual And Interaction Approach

The visual direction should be clean, map-forward, and civic rather than playful. Gamification elements can use badges, progress bars, and small celebratory moments, but they should not overwhelm the map.

Recommended tone:

- Clear
- Helpful
- Local
- Slightly adventurous
- Not childish
- Not competitive to the point of encouraging spam

Primary UI surfaces:

- Map pins with rating and status
- Detail bottom sheet or side panel
- Add button anchored to the map
- Contribution prompt card for local gaps
- Profile progress area
- Badge shelf
- Local leaderboard

## MVP Design Scope

The first complete design pass should cover:

- Home map
- Empty or sparse area state
- Fountain detail
- Add fountain flow
- Rate fountain flow
- Verify fountain action
- Profile contribution summary
- Badge display
- Local progress prompt
- Local leaderboard

The MVP does not need complex quests, rewards marketplace, social following, comments, or push notification campaigns. Those can come after the core contribution loop is working.

## Success Signals

The design is working if users:

- Add fountains in areas with sparse data.
- Rate fountains they did not add.
- Verify older fountains.
- Add photos that improve confidence.
- Return to see local progress.
- Compete locally without creating low-quality submissions.

## Open Product Decisions

- Whether "Water Scouts" is the final public name for contributors.
- Whether points are visible as a numeric score or only as levels/badges.
- Whether badges should be global, local, seasonal, or all three.
- How strict proximity checks should be for verification rewards.
- Whether early founder badges should be limited by date, user count, contribution count, or city launch.

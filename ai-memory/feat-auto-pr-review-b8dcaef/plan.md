1. New `server/prReviewAutomationService.js` - core pipeline service
2. Extend webhook handler in `server/index.js` for PR opened + review submitted
3. Add API endpoints: POST run, GET status, PUT config
4. Add `pr-review-poll` scheduler template
5. Register `pr-review-poll` command in commandRegistry

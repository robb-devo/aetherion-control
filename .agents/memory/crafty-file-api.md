---
name: Crafty file API coverage
description: Compatibility guidance for Crafty Controller file and backup administration routes.
---

Treat Crafty’s published v2 OpenAPI document as incomplete for file and backup administration. Verify those routes against the deployed controller or current Crafty-compatible clients before changing the integration.

**Why:** The published v2 reference documented stats, logs, actions, and users but omitted active file-manager and backup-manager routes exposed by current Crafty 4 controllers.

**How to apply:** When upgrading Crafty or extending administration features, confirm request methods, body keys, and response envelopes with the target controller. Keep normalization at the integration boundary because response fields can vary by Crafty version.
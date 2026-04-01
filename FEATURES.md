# ContractShield AI — Complete Features Documentation

**Version:** 2.0 (Tier 1 + Tier 2)
**Last Updated:** April 2026
**Total Features:** 34
**Test Coverage:** 343 automated tests (100% pass rate)

---

## Table of Contents

1. [Core Analysis Engine (8 features)](#1-core-analysis-engine)
2. [AI-Powered Tools (4 features)](#2-ai-powered-tools)
3. [Organization & Tracking (7 features)](#3-organization--tracking)
4. [Export & Sharing (5 features)](#4-export--sharing)
5. [Platform & Infrastructure (4 features)](#5-platform--infrastructure)
6. [Team & Collaboration — Tier 2 (3 features)](#6-team--collaboration--tier-2)
7. [Security & Developer — Tier 2 (3 features)](#7-security--developer--tier-2)
8. [Bonus Features](#8-bonus-features)
9. [API Reference (46 endpoints)](#9-api-reference)
10. [Database Schema (11 tables, 17 indexes)](#10-database-schema)
11. [Plan Limits & Pricing](#11-plan-limits--pricing)
12. [Tech Stack & Architecture](#12-tech-stack--architecture)

---

## 1. Core Analysis Engine

### 1.1 AI Contract Analysis
- **Endpoint:** `POST /api/analyze`
- **How it works:** Upload a PDF or TXT file. The document is parsed, text is extracted (up to 100,000 characters), and sent to Claude AI (claude-sonnet-4-6) with a specialized legal analysis prompt.
- **Output:** Structured JSON with summary, document type, parties, key dates, financial terms, clause-by-clause breakdown, missing clauses, risk score, red flags, action items, negotiation points, compliance notes, and language detection.
- **File limits:** Max 20MB. Supported formats: PDF, TXT, DOC, DOCX (DOC/DOCX requires conversion to PDF).
- **Auth:** Optional. Logged-in users get history tracking and usage counting.

### 1.2 Risk Scoring
- **Scale:** 1-10 integer score
- **Labels:** Low Risk (1-3), Moderate Risk (4-5), High Risk (6-7), Critical Risk (8-10)
- **Color coding:** Green (low), Yellow (moderate), Red (high), Dark red (critical)
- **Applied to:** Overall document and individual clauses (low/medium/high/critical per clause)

### 1.3 Red Flag Detection
- Automatic identification of dangerous clauses, unfair terms, and hidden obligations
- Returned as a flat array of plain-English descriptions
- Highlighted in the UI and included in email notifications and DOCX exports

### 1.4 Missing Clause Alerts
- AI identifies clauses that should be present but aren't
- Each missing clause includes: name, importance (high/medium), and reason it should be included
- Examples: Limitation of Liability, Dispute Resolution, Force Majeure

### 1.5 Financial Terms Extraction
- Pulls out all payment amounts, penalties, fees
- Each term includes: item description, amount/formula, frequency (one-time/monthly/annual/etc.)

### 1.6 Compliance Notes
- Auto-flags GDPR, HIPAA, CCPA, SOX, and state-specific regulatory concerns
- Returned as an array of plain-English compliance observations

### 1.7 Legal References
- Each analyzed clause links to relevant laws, standards, or regulations
- Examples: UTSA (trade secrets), UCC Article 2 (sales), FTC Non-Compete Rule, Delaware Corp Law

### 1.8 Multi-Language Support
- **10 languages:** English, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Arabic, Hindi
- **How it works:** Pass `language` parameter in the upload request. Set to `auto` for automatic detection.
- The entire analysis output (all JSON text values) is returned in the requested language.

---

## 2. AI-Powered Tools

### 2.1 AI Chat Follow-up
- **Endpoint:** `POST /api/chat`
- **How it works:** Send a question along with the analysis context. Supports conversation history (last 10 messages).
- **Context passed to AI:** Filename, document type, summary, risk score, parties, clause list with risk levels, red flags, missing clauses.
- **Use case:** "Is this non-compete enforceable in California?", "What does the indemnification clause mean for me?"

### 2.2 AI Clause Rewriter
- **Endpoint:** `POST /api/rewrite-clause`
- **Input:** Clause title, clause text, risk level, risk reason, contract context
- **Output:** Original text, rewritten text, list of changes made, risk reduction explanation, negotiation tip for presenting the change to the other party

### 2.3 Contract Comparison
- **Endpoint:** `POST /api/compare`
- **How it works:** Upload two documents (documentA, documentB). Both are parsed and sent to Claude for side-by-side analysis.
- **Output:** Summary of differences, similarities, per-topic differences (with which_is_better flag), risk comparison (score + label for each), overall recommendation
- **Plan restriction:** Starter+ (5/month on Starter, unlimited on Professional+)

### 2.4 Template Generator
- **Endpoint:** `POST /api/generate`
- **Supported types:** 11 contract types (NDA, Service Agreement, Employment, Lease, Partnership, Freelance, Sales, Licensing, Consulting, Non-Compete, SLA)
- **Input:** Template type + custom details (JSON)
- **Output:** Title, full contract content, sections array, customization notes, legal disclaimer
- **Plan restriction:** Starter+ (5/month on Starter, unlimited on Professional+)

---

## 3. Organization & Tracking

### 3.1 Analysis History
- **Endpoints:** `GET /api/auth/history`, `GET /api/auth/history/:analysisId`, `DELETE /api/auth/history/:id`
- Stores every analysis with: filename, document type, risk score, risk label, full analysis data, timestamp
- Returns last 100 analyses sorted by date (newest first)
- Can retrieve full analysis data by analysis ID

### 3.2 Enhanced History with Folders & Tags
- **Endpoint:** `GET /api/auth/history-full`
- **Query parameters:** `folder_id`, `tag`, `search`
- Returns analyses with folder name/color joins
- Search matches against filename and document type

### 3.3 Contract Folders
- **Endpoints:** `GET/POST/PUT/DELETE /api/folders`
- Color-coded folders (default: #4f46e5 indigo)
- Move analyses to folders via `PUT /api/auth/history/:id/folder`
- Deleting a folder unassigns all analyses (doesn't delete them)
- Supports team folders (team_id column)

### 3.4 Tags
- **Endpoint:** `PUT /api/auth/history/:id/tags`
- Comma-separated tag storage on each analysis
- Filterable in enhanced history via `tag` query parameter

### 3.5 Annotations & Notes
- **Endpoints:** `GET/POST/DELETE /api/annotations`
- Per-clause notes (clause_index) or general notes (clause_index = -1)
- Scoped to user + analysis_id
- Sorted by clause_index then created_at

### 3.6 Deadline Tracker
- **Endpoints:** `GET/POST/PUT/DELETE /api/deadlines`
- Fields: title, deadline_date, contract_name, alert_days (default 30), is_auto_renewal flag, notes, status
- Sorted by deadline_date ascending (most urgent first)
- Hourly background check sends email alerts when deadlines approach (within alert_days)
- Deduplicates alerts: only one email per deadline per day

### 3.7 Analytics Dashboard
- Portfolio-wide stats rendered client-side from history data
- Includes: total analyses, average risk, risk distribution chart, common red flags, document type breakdown
- **Risk Trend Sparkline:** Visual chart showing how contract risk has changed over time (rendered via `renderRiskTrend()` in app.js)

---

## 4. Export & Sharing

### 4.1 PDF Export
- Client-side PDF generation via `exportPDF()` function in app.js
- Branded report with ContractShield AI header
- Includes all analysis sections: summary, risk score, clauses, red flags, action items

### 4.2 Word/DOCX Export
- **Endpoint:** `POST /api/export/docx`
- Server-side generation using the `docx` library
- **Sections included:** Title page, file metadata, risk score (color-coded), summary, red flags, financial terms, key dates, clause-by-clause analysis (with risk level badges, recommendations, legal references), missing clauses, compliance notes, action items, negotiation points, disclaimer
- Returns downloadable .docx file with proper Content-Disposition header

### 4.3 Shareable Links
- **Endpoints:** `POST /api/share`, `GET /api/shared/:shareId`
- Generates unique 32-character hex share ID
- Optional expiry (expires_hours parameter, defaults to no expiry)
- Expired links return 410 Gone and are auto-deleted
- Share URL format: `{APP_URL}/shared/{shareId}`
- Public access (no auth required to view)

### 4.4 Batch Upload
- **Endpoint:** `POST /api/batch-analyze`
- Upload up to 10 documents at once
- Returns: total count, successful count, failed count, average risk score, per-document results
- Each document analyzed independently (sequential processing)
- **Plan restriction:** Professional+ only

### 4.5 Clause Library
- **Endpoint:** `GET /api/clause-library`
- 15 built-in standard legal clauses across 10 categories
- **Categories:** Confidentiality, Indemnification, Liability, Termination, Intellectual Property, Force Majeure, Dispute Resolution, Non-Compete, Payment Terms, Warranty, Data Protection, Non-Solicitation
- **Query parameters:** `category` (filter), `search` (full-text search on title, text, category)
- Copy-paste ready clause text

---

## 5. Platform & Infrastructure

### 5.1 Authentication
- **Email/password registration:** `POST /api/auth/signup`
  - Validation: required fields (email, password, name), password min 8 chars, email format check, duplicate detection
  - Password hashing: bcrypt with salt rounds 10
  - Returns JWT token (7-day expiry)
- **Email/password login:** `POST /api/auth/login`
- **OAuth SSO:** `POST /api/auth/oauth`
  - Providers: Google, Microsoft
  - Auto-links OAuth to existing accounts by email
  - Creates new account with random password if no match
- **Session:** `GET /api/auth/me` — returns user profile + plan limits
- **Profile update:** `PUT /api/auth/profile` — update name and company

### 5.2 Stripe Payments
- **3-tier subscription:** Starter ($49/mo), Professional ($149/mo), Enterprise ($499/mo)
- **Checkout:** `POST /api/billing/checkout` — creates Stripe Checkout session
- **Billing portal:** `POST /api/billing/portal` — Stripe self-service portal for managing subscription
- **Status:** `GET /api/billing/status` — current plan, limits, usage, subscription status
- **Webhook handler:** `POST /api/webhooks/stripe` — handles checkout.session.completed, subscription.updated, subscription.deleted, invoice.payment_failed
- Graceful degradation: works without Stripe keys (returns error message)

### 5.3 Email Notifications
- **4 email templates:**
  1. **Welcome email** — sent on signup, includes feature highlights and CTA
  2. **Analysis complete** — sent after each analysis with risk score, red flags summary, and link
  3. **Deadline alert** — sent when contract deadline approaches (within alert_days), with urgency labels (UPCOMING/URGENT/OVERDUE)
  4. **Weekly digest** — summary of analyses this week, average risk, upcoming deadlines
- **Preferences:** `PUT /api/auth/email-prefs` — toggle each notification type independently
- **SMTP configuration:** Host, port, user, pass, secure flag, sender address
- All emails include branded HTML template with ContractShield AI header
- Email log stored in `email_log` table for deduplication

### 5.4 Onboarding Tutorial
- **Endpoint:** `PUT /api/auth/onboarding` — marks tutorial as complete
- 4-step guided walkthrough for first-time users
- `onboarding_completed` flag on user record
- Tracked per-user, shown only once

---

## 6. Team & Collaboration (Tier 2)

### 6.1 Team Workspaces
- **Create team:** `POST /api/teams` — creates team, assigns creator as admin
- **View team:** `GET /api/teams/me` — returns team info, members list (id, name, email, role, avatar), pending invites, caller's role
- **Invite members:** `POST /api/teams/invite` — admin-only, generates unique invite code + URL
- **Join team:** `POST /api/teams/join/:code` — accepts pending invite, assigns role
- **Leave team:** `POST /api/teams/leave` — transfers ownership to next member or deletes team if last member
- **Change roles:** `PUT /api/teams/members/:userId/role` — admin-only, valid roles: admin, member, viewer
- **Team analyses:** `GET /api/teams/analyses` — all analyses uploaded by team members (last 100)
- **Constraints:** A user can only belong to one team at a time

### 6.2 Custom Clause Library
- **Endpoints:** `GET/POST/PUT/DELETE /api/custom-clauses`
- Users create their own clause templates (category, title, text)
- **Team sharing:** Set `share_with_team: true` to make a clause visible to all team members
- Query returns both personal clauses and team-shared clauses
- Only the creator can edit/delete their clauses

### 6.3 Contract Version Tracking
- **Create version group:** `POST /api/versions/create-group` — assigns an analysis as v1 of a new group
- **Add version:** `PUT /api/versions/:analysisId/assign` — adds an analysis to an existing group (auto-increments version number)
- **List versions:** `GET /api/versions/:versionGroup` — returns all versions sorted by version number
- **Compare versions:** `GET /api/versions/:versionGroup/compare` — compares first and last versions:
  - Risk score change (delta + improved flag)
  - Clause-by-clause comparison: added, removed, changed (with improved flag)
  - New red flags vs. resolved red flags
  - Full version timeline with risk scores and dates

---

## 7. Security & Developer (Tier 2)

### 7.1 Two-Factor Authentication (2FA)
- **Setup:** `POST /api/auth/2fa/setup` — generates TOTP secret (32 chars), QR code (data URI), and 8 backup codes
- **Verify:** `POST /api/auth/2fa/verify` — validates TOTP token to enable 2FA
- **Login with 2FA:** `POST /api/auth/login-2fa` — enhanced login that:
  - Returns `requires_2fa: true` if 2FA enabled and no token provided
  - Accepts `totp_token` (TOTP app) or `backup_code` (one-time use)
  - Backup codes are consumed on use (removed from stored array)
- **Disable:** `POST /api/auth/2fa/disable` — requires valid TOTP token to disable
- **Library:** otplib for TOTP generation/verification, qrcode for QR code generation
- Blocks duplicate setup (returns error if already enabled)

### 7.2 Developer API Keys
- **Endpoints:** `GET/POST/DELETE /api/keys`
- **Plan restriction:** Enterprise only
- **Key format:** `csk_` prefix + 64 hex characters (32 random bytes)
- **Storage:** SHA-256 hash stored in DB (raw key shown once on creation)
- **Display:** Masked prefix shown in list (e.g., `csk_a1b2c3d4...`)
- **Authentication:** Via `X-API-Key` header (falls through to JWT if not present)
- **Rate limiting:** 1,000 requests/day per key (auto-resets daily)
- **Tracking:** Last used timestamp, daily request count

### 7.3 Webhook Integrations
- **Endpoints:** `GET/POST/DELETE /api/webhooks`, `PUT /api/webhooks/:id/toggle`
- **Valid events:** `analysis_complete`, `deadline_alert`, `team_invite`, `version_uploaded`
- **Signing secret:** `whsec_` prefix + 48 hex characters (24 random bytes), shown once on creation
- **Payload delivery:**
  - HTTP POST to registered URL
  - Body: `{ event, data, timestamp }`
  - Headers: `X-Webhook-Signature` (HMAC-SHA256 of body with secret), `X-Webhook-Event`
  - Supports HTTP and HTTPS endpoints
- **Reliability:** Failure count tracked per webhook, auto-resets on success
- **Toggle:** Enable/disable without deleting

---

## 8. Bonus Features

### 8.1 Dark Mode
- System preference detection via `prefers-color-scheme` media query
- Manual toggle via `toggleTheme()` function
- CSS custom properties for seamless theme switching

### 8.2 Mobile Responsive Design
- Fully responsive CSS with media queries
- Touch-friendly UI elements

### 8.3 XSS Protection
- `escapeHtml()` function applied to all user-generated content before DOM insertion
- Prevents script injection in analysis results, notes, filenames, etc.

### 8.4 Toast Notifications
- `toast()` function for all user actions
- Success, error, and info variants

### 8.5 Sector Landing Pages
- **5 sectors:** Real Estate, Freelancers, Startups, HR, Construction
- **Route:** `GET /for/:sector`
- Served via SPA with sector-specific content loaded by `loadSectorPage()`

### 8.6 Demo Mode
- **Endpoints:** `POST /api/demo`, `POST /api/demo/chat`
- Returns realistic hardcoded NDA analysis (no API key needed)
- Demo chat returns pre-written advice with formatting
- Use case: Sales demos, onboarding, testing

---

## 9. API Reference

### Authentication
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/signup` | None | Register with email/password |
| POST | `/api/auth/login` | None | Login with email/password |
| POST | `/api/auth/login-2fa` | None | Login with 2FA support |
| POST | `/api/auth/oauth` | None | Google/Microsoft SSO |
| GET | `/api/auth/me` | JWT | Current user + plan limits |
| PUT | `/api/auth/profile` | JWT | Update name/company |
| PUT | `/api/auth/email-prefs` | JWT | Toggle notification types |
| PUT | `/api/auth/onboarding` | JWT | Mark tutorial complete |
| POST | `/api/auth/2fa/setup` | JWT | Generate 2FA secret + QR |
| POST | `/api/auth/2fa/verify` | JWT | Enable 2FA with TOTP |
| POST | `/api/auth/2fa/disable` | JWT | Disable 2FA |

### Analysis
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/analyze` | Optional | Upload + analyze contract |
| POST | `/api/batch-analyze` | Optional | Batch upload (up to 10) |
| POST | `/api/compare` | Optional | Compare two contracts |
| POST | `/api/generate` | Optional | Generate contract from template |
| POST | `/api/chat` | Optional | AI follow-up questions |
| POST | `/api/rewrite-clause` | Optional | AI clause rewriter |
| POST | `/api/demo` | None | Demo analysis (no API key) |
| POST | `/api/demo/chat` | None | Demo chat response |

### History & Organization
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/auth/history` | JWT | List analyses (last 100) |
| GET | `/api/auth/history/:analysisId` | JWT | Get full analysis data |
| DELETE | `/api/auth/history/:id` | JWT | Delete analysis |
| GET | `/api/auth/history-full` | JWT | Enhanced history with filters |
| PUT | `/api/auth/history/:id/folder` | JWT | Move analysis to folder |
| PUT | `/api/auth/history/:id/tags` | JWT | Update analysis tags |
| GET/POST/PUT/DELETE | `/api/folders` | JWT | Folder CRUD |
| GET/POST/DELETE | `/api/annotations` | JWT | Annotations CRUD |
| GET/POST/PUT/DELETE | `/api/deadlines` | JWT | Deadline tracker CRUD |

### Export & Sharing
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/export/docx` | None | Generate Word document |
| POST | `/api/share` | JWT | Create shareable link |
| GET | `/api/shared/:shareId` | None | View shared analysis |

### Billing
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/billing/checkout` | JWT | Create Stripe checkout |
| POST | `/api/billing/portal` | JWT | Open billing portal |
| GET | `/api/billing/status` | JWT | Plan + usage info |
| POST | `/api/webhooks/stripe` | Stripe sig | Stripe webhook handler |

### Clause Library
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/clause-library` | None | Browse/search built-in clauses |
| GET/POST/PUT/DELETE | `/api/custom-clauses` | JWT | Custom clause CRUD |

### Teams
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/teams` | JWT | Create team |
| GET | `/api/teams/me` | JWT | Get team info + members |
| POST | `/api/teams/invite` | JWT (admin) | Invite member |
| POST | `/api/teams/join/:code` | JWT | Accept invite |
| POST | `/api/teams/leave` | JWT | Leave team |
| PUT | `/api/teams/members/:userId/role` | JWT (admin) | Change member role |
| GET | `/api/teams/analyses` | JWT | Team-wide analyses |

### Developer
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET/POST/DELETE | `/api/keys` | JWT | API key management |
| GET/POST/DELETE | `/api/webhooks` | JWT | Webhook management |
| PUT | `/api/webhooks/:id/toggle` | JWT | Toggle webhook active state |

### Version Tracking
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/versions/create-group` | JWT | Create version group |
| PUT | `/api/versions/:analysisId/assign` | JWT | Add version to group |
| GET | `/api/versions/:versionGroup` | JWT | List versions in group |
| GET | `/api/versions/:versionGroup/compare` | JWT | Compare first vs. last version |

### Pages
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | None | SPA (index.html) |
| GET | `/for/:sector` | None | Sector landing page |
| GET | `/shared/:shareId` | None | Shared analysis page |
| GET | `/join/:code` | None | Team invite page |

---

## 10. Database Schema

### Tables (11)

**users** — User accounts and settings
```
id, email (unique), password, name, company, plan, stripe_customer_id,
stripe_subscription_id, analyses_used, analyses_reset_at, oauth_provider,
oauth_id, avatar_url, email_notifications, email_deadline_alerts,
email_weekly_digest, onboarding_completed, totp_secret, totp_enabled,
backup_codes, team_id, team_role, created_at, updated_at
```

**analyses** — Stored analysis results
```
id, user_id (FK), analysis_id, filename, document_type, risk_score,
risk_label, folder_id, tags, version_group, version_number, team_id,
data (JSON), created_at
```

**folders** — Color-coded folders
```
id, user_id (FK), name, color, team_id, created_at
```

**shared_analyses** — Shareable links
```
id, share_id (unique), user_id (FK), analysis_id, data (JSON),
expires_at, created_at
```

**annotations** — Per-clause notes
```
id, user_id (FK), analysis_id, clause_index, note, created_at, updated_at
```

**contract_deadlines** — Expiry/renewal tracking
```
id, user_id (FK), analysis_id, title, deadline_date, contract_name,
alert_days, is_auto_renewal, notes, status, created_at
```

**email_log** — Sent notification history
```
id, user_id, email_type, subject, sent_at
```

**teams** — Team workspaces
```
id, name, owner_id (FK), plan, created_at
```

**team_invites** — Pending team invitations
```
id, team_id (FK), email, role, invite_code (unique), status, created_at
```

**api_keys** — Developer API keys
```
id, user_id (FK), key_hash (unique), key_prefix, name, last_used_at,
requests_today, requests_reset_at, is_active, created_at
```

**webhooks** — Webhook integrations
```
id, user_id (FK), url, events, secret, is_active, last_triggered_at,
failure_count, created_at
```

**custom_clauses** — User/team clause templates
```
id, user_id (FK), category, title, text, team_id, created_at
```

### Indexes (17)
```
idx_analyses_user (user_id)
idx_analyses_folder (folder_id)
idx_analyses_version (version_group)
idx_analyses_team (team_id)
idx_users_email (email)
idx_users_stripe (stripe_customer_id)
idx_users_oauth (oauth_provider, oauth_id)
idx_users_team (team_id)
idx_shared (share_id)
idx_annotations (user_id, analysis_id)
idx_deadlines (user_id)
idx_folders (user_id)
idx_api_keys (key_hash)
idx_api_keys_user (user_id)
idx_webhooks (user_id)
idx_custom_clauses (user_id)
idx_team_invites (invite_code)
```

---

## 11. Plan Limits & Pricing

| Feature | Free | Starter ($49/mo) | Professional ($149/mo) | Enterprise ($499/mo) |
|---------|------|-------------------|------------------------|----------------------|
| Analyses/month | 3 | 10 | 50 | Unlimited |
| AI Chat messages | 10 | 50 | Unlimited | Unlimited |
| Contract Comparison | No | 5/month | Unlimited | Unlimited |
| Template Generator | No | 5/month | Unlimited | Unlimited |
| PDF/DOCX Export | Yes | Yes | Yes | Yes |
| Batch Upload | No | No | Yes | Yes |
| Shareable Links | No | Yes | Yes | Yes |
| Clause Library | Yes | Yes | Yes | Yes |
| Deadline Tracker | Yes | Yes | Yes | Yes |
| Custom Clauses | Yes | Yes | Yes | Yes |
| Team Workspaces | No | No | No | Yes |
| API Keys | No | No | No | Yes |
| Webhooks | Yes | Yes | Yes | Yes |
| 2FA | Yes | Yes | Yes | Yes |

---

## 12. Tech Stack & Architecture

### Stack
- **Runtime:** Node.js
- **Framework:** Express 5
- **Database:** SQLite (via better-sqlite3, WAL mode)
- **AI:** Claude API (claude-sonnet-4-6 model) via @anthropic-ai/sdk
- **Payments:** Stripe (checkout, portal, webhooks)
- **Auth:** JWT (jsonwebtoken) + bcrypt (bcryptjs)
- **2FA:** otplib (TOTP) + qrcode (QR generation)
- **Email:** Nodemailer with configurable SMTP
- **File parsing:** pdf-parse (PDF), native fs (TXT)
- **DOCX generation:** docx library
- **File upload:** Multer (20MB limit)
- **Frontend:** Vanilla JS SPA (zero framework), CSS with dark mode

### File Structure
```
AIPRODUCTS/
├── server.js              # Express server (1378 lines) — all 46 API routes
├── lib/
│   ├── db.js              # SQLite schema (11 tables, 17 indexes)
│   ├── auth.js            # JWT auth, bcrypt, plan limits, middleware
│   ├── stripe.js          # Checkout, portal, webhook handler
│   ├── email.js           # Nodemailer + 4 email templates
│   └── docx-export.js     # Word document generation
├── public/
│   ├── index.html         # 12-page SPA
│   ├── style.css          # Responsive styles + dark mode
│   └── app.js             # Client-side logic (50+ functions)
├── test.js                # 89 core tests
├── test-full.js           # 201 extended tests (23 features)
├── test-tier2.js          # 53 Tier 2 tests (6 features)
├── test-e2e.js            # End-to-end tests (real AI calls)
├── .env.example           # All configuration documented
└── package.json           # 12 dependencies
```

### Environment Variables
```
# Required
ANTHROPIC_API_KEY          — Claude API key (console.anthropic.com)
JWT_SECRET                 — Random 32+ char string for production

# Optional
PORT                       — Server port (default: 3001)
APP_URL                    — Public URL for emails/share links

# Stripe (optional)
STRIPE_SECRET_KEY          — From dashboard.stripe.com
STRIPE_WEBHOOK_SECRET      — Webhook signing secret
STRIPE_STARTER_PRICE_ID    — Price ID for Starter plan
STRIPE_PRO_PRICE_ID        — Price ID for Professional plan
STRIPE_ENTERPRISE_PRICE_ID — Price ID for Enterprise plan

# OAuth (optional)
GOOGLE_CLIENT_ID           — From console.cloud.google.com
MICROSOFT_CLIENT_ID        — From portal.azure.com

# Email (optional)
SMTP_HOST                  — e.g., smtp.gmail.com
SMTP_PORT                  — e.g., 587
SMTP_USER / SMTP_PASS      — SMTP credentials
SMTP_SECURE                — "true" for SSL
EMAIL_FROM                 — Sender name and address
```

### Quick Start
```bash
npm install
cp .env.example .env       # Add ANTHROPIC_API_KEY
npm start                  # http://localhost:3001
```

### Running Tests
```bash
# Each test suite requires a fresh database
rm -f data.db data.db-shm data.db-wal

npm start &                # Start server
node test.js               # 89 core tests
node test-full.js          # 201 extended tests
node test-tier2.js         # 53 tier 2 tests
node test-e2e.js           # E2E tests (needs API key)
```

**Note:** Test suites share user emails so they must run against separate clean databases. Running them sequentially on the same DB will cause user conflicts.

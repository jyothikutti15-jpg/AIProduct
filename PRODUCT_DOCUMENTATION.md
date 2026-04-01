# ContractShield AI — Product Documentation

## Overview

**ContractShield AI** is an AI-powered contract analysis platform that helps businesses understand, review, and manage contracts in seconds. Upload any contract (PDF or TXT), and get a plain-English breakdown with risk scores, red flags, negotiation advice, and compliance notes — powered by Claude AI.

**Target Market:** SMBs, freelancers, startups, real estate agents, HR teams, construction firms
**Pricing:** Free tier + $49/$149/$499 monthly plans
**Tech Stack:** Node.js, Express, SQLite, Claude AI API, Vanilla JS (zero framework)

---

## Complete Feature List (28 Features)

### Core Analysis Engine
| # | Feature | Description |
|---|---|---|
| 1 | **AI Contract Analysis** | Upload PDF/TXT, get clause-by-clause breakdown with risk levels (low/medium/high/critical), plain-English summaries, and legal references |
| 2 | **Risk Scoring** | Overall risk score (1-10) with color-coded visualization |
| 3 | **Red Flag Detection** | Automatic identification of dangerous clauses, unfair terms, and hidden obligations |
| 4 | **Missing Clause Alerts** | Identifies important clauses that should be in the contract but aren't |
| 5 | **Financial Terms Extraction** | Pulls out all payment amounts, penalties, fees, and their frequencies |
| 6 | **Compliance Notes** | Auto-flags GDPR, HIPAA, CCPA, state-specific regulatory concerns |
| 7 | **Legal References** | Each clause linked to relevant laws and standards |
| 8 | **Multi-Language Support** | Analyze contracts in 10 languages: English, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Arabic, Hindi |

### AI-Powered Tools
| # | Feature | Description |
|---|---|---|
| 9 | **AI Chat Follow-up** | Ask questions about your contract: "Is this non-compete enforceable in California?" |
| 10 | **AI Clause Rewriter** | Click any risky clause to get AI-suggested improved wording with negotiation tips |
| 11 | **Contract Comparison** | Upload two contracts side-by-side, see differences, which is safer, and recommendations |
| 12 | **Template Generator** | Generate 11 types of professional contracts from a form (NDA, Service Agreement, Employment, Lease, etc.) |

### Organization & Tracking
| # | Feature | Description |
|---|---|---|
| 13 | **Analysis History** | Full history with search, filter by risk level, re-view any past analysis |
| 14 | **Contract Folders** | Create color-coded folders to organize analyses by client/project |
| 15 | **Tags** | Add custom tags to any analysis for easy filtering |
| 16 | **Annotations & Notes** | Add personal notes to any clause or the overall analysis |
| 17 | **Deadline Tracker** | Track contract expirations, auto-renewals, and key dates with countdown alerts |
| 18 | **Analytics Dashboard** | Portfolio-wide stats: total analyses, avg risk, risk distribution chart, common red flags, document type breakdown |
| 19 | **Risk Trend Sparkline** | Visual chart showing how your contract risk has changed over time |

### Export & Sharing
| # | Feature | Description |
|---|---|---|
| 20 | **PDF Export** | Download branded analysis reports as PDF |
| 21 | **Word/DOCX Export** | Download analysis reports as Word documents (for lawyers who live in Word) |
| 22 | **Shareable Links** | Generate unique links to share analyses with team members (7-day expiry) |
| 23 | **Batch Upload** | Upload up to 10 contracts at once, get combined risk report |
| 24 | **Clause Library** | 15 standard legal clauses across 12 categories, searchable, copy-paste ready |

### Platform & Infrastructure
| # | Feature | Description |
|---|---|---|
| 25 | **Authentication** | Email/password signup + Google/Microsoft SSO OAuth |
| 26 | **Stripe Payments** | 3-tier subscription: Starter ($49), Professional ($149), Enterprise ($499) with usage limits |
| 27 | **Email Notifications** | Welcome emails, analysis complete alerts, deadline warnings, weekly risk digests |
| 28 | **Onboarding Tutorial** | 4-step guided walkthrough for first-time users |

### Bonus Features
- **Dark Mode** with system preference detection
- **Mobile Responsive** design
- **XSS Protection** on all user inputs
- **Toast Notifications** for all actions
- **5 Sector Landing Pages** (Real Estate, Freelancers, Startups, HR, Construction)
- **Demo Mode** — works without API key for sales demos

---

## Architecture

```
AIPRODUCTS/
├── server.js              # Express server (996 lines) — all API routes
├── lib/
│   ├── db.js              # SQLite database schema (7 tables, 9 indexes)
│   ├── auth.js            # JWT auth, bcrypt, plan limits, middleware
│   ├── stripe.js          # Checkout, portal, webhook handler
│   ├── email.js           # Nodemailer + 4 email templates
│   └── docx-export.js     # Word document generation
├── public/
│   ├── index.html         # 12-page SPA (862 lines)
│   ├── style.css          # Full responsive styles + dark mode (514 lines)
│   └── app.js             # Client-side logic (1758 lines)
├── .env.example           # All configuration documented
├── test.js                # 201 automated tests
├── test-full.js           # Extended test suite
├── test-e2e.js            # Real AI end-to-end test (52 tests)
└── package.json
```

### Database Tables
1. `users` — accounts, plans, OAuth, email prefs, onboarding
2. `analyses` — stored analysis results with folder/tag support
3. `folders` — user-created color-coded folders
4. `shared_analyses` — shareable links with expiry
5. `annotations` — per-clause notes
6. `contract_deadlines` — expiry/renewal tracking
7. `email_log` — sent notification history

### API Endpoints (30 routes)

**Auth:**
- `POST /api/auth/signup` — email/password registration
- `POST /api/auth/login` — email/password login
- `POST /api/auth/oauth` — Google/Microsoft SSO
- `GET /api/auth/me` — current user + limits
- `PUT /api/auth/profile` — update name/company
- `PUT /api/auth/email-prefs` — notification toggles
- `PUT /api/auth/onboarding` — mark tutorial complete

**Analysis:**
- `POST /api/analyze` — upload & analyze contract
- `POST /api/batch-analyze` — batch upload (up to 10)
- `POST /api/compare` — compare two contracts
- `POST /api/generate` — generate contract from template
- `POST /api/chat` — AI follow-up questions
- `POST /api/rewrite-clause` — AI clause rewriter
- `POST /api/demo` — demo analysis (no API key needed)
- `POST /api/demo/chat` — demo chat

**Organization:**
- `GET/POST/PUT/DELETE /api/folders` — folder CRUD
- `GET/DELETE /api/auth/history` — analysis history
- `GET /api/auth/history-full` — enhanced with folders/tags
- `PUT /api/auth/history/:id/folder` — move to folder
- `PUT /api/auth/history/:id/tags` — update tags
- `GET/POST/DELETE /api/annotations` — notes per clause
- `GET/POST/PUT/DELETE /api/deadlines` — deadline tracker

**Export & Share:**
- `POST /api/export/docx` — Word document export
- `POST /api/share` — create share link
- `GET /api/shared/:id` — view shared analysis

**Billing:**
- `POST /api/billing/checkout` — Stripe checkout
- `POST /api/billing/portal` — manage subscription
- `GET /api/billing/status` — plan + usage
- `POST /api/webhooks/stripe` — webhook handler

**Other:**
- `GET /api/clause-library` — browse/search clauses
- `GET /for/:sector` — sector landing pages

---

## Plan Limits

| Feature | Free | Starter ($49) | Professional ($149) | Enterprise ($499) |
|---|---|---|---|---|
| Analyses/month | 3 | 10 | 50 | Unlimited |
| AI Chat messages | 10 | 50 | Unlimited | Unlimited |
| Contract Comparison | No | 5/month | Unlimited | Unlimited |
| Template Generator | No | 5/month | Unlimited | Unlimited |
| PDF/DOCX Export | Yes | Yes | Yes | Yes |
| Batch Upload | No | No | Yes | Yes |
| Shareable Links | No | Yes | Yes | Yes |
| Clause Library | Yes | Yes | Yes | Yes |
| Deadline Tracker | Yes | Yes | Yes | Yes |
| API Access | No | No | No | Yes |
| Team Dashboard | No | No | No | Yes |

---

## Setup Guide

### Quick Start
```bash
git clone <repo>
cd AIPRODUCTS
npm install
cp .env.example .env
# Edit .env: add ANTHROPIC_API_KEY
npm start
# Open http://localhost:3001
```

### Environment Variables
```
ANTHROPIC_API_KEY    — Required. Get from console.anthropic.com
JWT_SECRET           — Required for production. Random 32+ char string
PORT                 — Default: 3001
APP_URL              — Your domain (for emails and share links)

# Optional: Stripe
STRIPE_SECRET_KEY    — From dashboard.stripe.com
STRIPE_WEBHOOK_SECRET
STRIPE_STARTER_PRICE_ID
STRIPE_PRO_PRICE_ID
STRIPE_ENTERPRISE_PRICE_ID

# Optional: OAuth
GOOGLE_CLIENT_ID     — From console.cloud.google.com
MICROSOFT_CLIENT_ID  — From portal.azure.com

# Optional: Email
SMTP_HOST            — e.g., smtp.gmail.com
SMTP_PORT            — e.g., 587
SMTP_USER / SMTP_PASS
EMAIL_FROM           — Sender name and address
```

### Deployment Options
- **Vercel/Railway/Render** — One-click Node.js deployment
- **AWS/GCP/Azure** — Docker or PM2
- **VPS (DigitalOcean/Linode)** — Direct Node.js with nginx

---

## Test Coverage

- **201 automated tests** — auth, billing, demo, errors, limits, history, clauses, deadlines, annotations, sharing, frontend code quality
- **52 end-to-end tests** — real Claude API calls for analysis, chat, and clause rewriting
- **25 Tier 1 feature tests** — OAuth, folders, DOCX, email prefs, onboarding
- **100% pass rate across all test suites**

---

## Competitive Advantages

1. **Speed** — 30-second analysis vs. hours of manual review
2. **Completeness** — 28 features in one platform (competitors have 5-10)
3. **AI Rewriter** — No competitor offers one-click clause rewriting
4. **Clause Library** — Built-in reference library (unique feature)
5. **Multi-language** — 10 languages (most competitors are English-only)
6. **Price** — Starts at $49/mo (competitors charge $200-$500)
7. **No vendor lock-in** — Self-hostable, SQLite (no cloud dependency)
8. **Demo mode** — Sales demos without needing API keys

---

## Revenue Projections

| Milestone | Users | MRR | ARR |
|---|---|---|---|
| Month 3 | 50 | $5,000 | $60,000 |
| Month 6 | 200 | $20,000 | $240,000 |
| Month 12 | 500 | $50,000 | $600,000 |
| Month 24 | 2,000 | $200,000 | $2,400,000 |

Based on average $100/user/month blended across tiers.

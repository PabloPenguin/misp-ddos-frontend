# MISP DDoS Events Dashboard

A lightweight, browser-based dashboard for visualising live DDoS threat intelligence from MISP (Malware Information Sharing Platform).

![Dashboard Preview](https://img.shields.io/badge/status-live-brightgreen) ![GitHub Pages](https://img.shields.io/badge/hosted-GitHub%20Pages-blue)

## 🌐 Live Demo

**[View the Dashboard →](https://pablopenguin.github.io/misp-ddos-frontend/)**

## ✨ Features

- **Real-time Data** — Automatically fetches DDoS event data every 5 minutes from the [misp-ddos-events](https://github.com/PabloPenguin/misp-ddos-events) feed
- **Interactive Filtering** — Filter by severity, TLP level, organisation, date range, or free-text search
- **Visual Analytics** — Four insight charts powered by Chart.js:
  - TLP distribution (doughnut)
  - Repeat attacker IPs (bar)
  - Event timeline (area)
  - Top reporting organisations (bar)
- **Detailed Event View** — Expandable rows showing attributes, objects, tags, and indicator statistics
- **Dark/Light Theme** — Toggle between themes with preference persistence
- **CSV Export** — Download filtered event data for offline analysis
- **Zero Backend** — Pure front-end stack suitable for static hosting

## 🚀 Quick Start

### View Online
Simply visit the [live dashboard](https://pablopenguin.github.io/misp-ddos-frontend/).

### Run Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/PabloPenguin/misp-ddos-frontend.git
   cd misp-ddos-frontend
   ```

2. Start a local server:
   ```bash
   # Python 3
   python -m http.server 8000
   
   # Or use any static file server
   npx serve .
   ```

3. Open `http://localhost:8000` in your browser.

## 📁 Project Structure

```
├── index.html          # Main dashboard page
├── requirements.md     # Detailed project specification
├── README.md           # This file
└── assets/
    ├── css/
    │   └── styles.css  # Themes and responsive layout
    └── js/
        └── app.js      # Data fetching, charts, and UI logic
```

## 🔗 Data Source

The dashboard consumes DDoS event data from:
- **Feed URL**: `https://raw.githubusercontent.com/PabloPenguin/misp-ddos-events/main/ddos_events.json`
- **Update Frequency**: Every 5 minutes
- **Repository**: [PabloPenguin/misp-ddos-events](https://github.com/PabloPenguin/misp-ddos-events)

## 🛠 Tech Stack

- **HTML5** — Semantic markup
- **CSS3** — Custom properties, dark/light themes, responsive design
- **Vanilla JavaScript** — ES modules, no framework dependencies
- **Chart.js v4.4.7** — Loaded via CDN for visualisations

## 📊 Dashboard Sections

| Section | Description |
|---------|-------------|
| **Summary Cards** | Total events, unique orgs, indicator count, high-severity tally |
| **Filter Panel** | Dropdowns for severity/TLP/org, date pickers, search box |
| **Charts** | TLP breakdown, repeat attackers, timeline, top reporters |
| **Events Table** | Sortable columns with expandable detail rows |

## 🎨 Themes

Toggle between **dark** (default) and **light** themes using the switch in the header. Your preference is saved to `localStorage`.

## 📝 License

This project is open source. See the repository for license details.

## 🤝 Contributing

Contributions are welcome! Please read [requirements.md](requirements.md) for implementation details and guidelines before submitting changes.

---

Built for SOC analysts who need rapid DDoS threat triage without infrastructure overhead.

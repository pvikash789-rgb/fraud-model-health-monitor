# Driftmeter

**Live demo:** https://pvikash789-rgb.github.io/Driftmeter/

Fraud changes faster than fraud models. Driftmeter is a browser-based prototype that scores card transactions with a predictive fraud model, then shows what happens when a new attack appears: how fast the model goes stale, how long monitoring takes to notice, and which retraining approach wins the losses back.

It runs entirely in the browser on synthetic data. No backend, no API keys, no real customer data.

## Why I built it

Banks and card networks run real-time fraud models that have to keep up with attacks that change every few weeks. The hard questions are not "can we train a model" but:

- How do we know the live model is going stale, and how early?
- Is the change in our customers or in the fraudsters?
- Is the retrained model actually better before we ship it?
- What alert rate costs the least once you count both missed fraud and good customers declined?
- How much faster could we react if we learned from fraud other banks have already seen?

Driftmeter turns each of these into something you can see and play with.

## What's inside

**Predictive fraud scoring.** Every transaction gets a calibrated fraud probability and reason codes (which signals pushed the score up or down). You can compare two models on the same transactions, for example the bank's own model against a network-informed one, a week into an attack.

**Five retraining policies on the same traffic.** Frozen, monthly, weekly, drift-triggered, and network-informed (drift-triggered plus confirmed fraud shared by peer banks).

**Drift monitoring.** A performance alarm on matured labels and a traffic alarm on score PSI, with each alarm diagnosed as data drift (customers changed) or concept drift (fraud changed).

**Champion vs challenger.** No alarm ships a model on its own. A challenger is trained out of time, validated on held-back days, and promoted only if it beats the live model on PR-AUC. Everything is logged in a model registry.

**Model quality.** ROC-AUC, PR-AUC, precision and recall at the alert budget, and precision-recall curves, measured after the attack.

**Explainability.** Feature attribution showing what the original model rewarded versus what the retrained model learned.

**Threshold economics.** Set the cost of wrongly declining a good customer and see the cheapest alert rate.

**GenAI hand-off.** When an alarm fires, the tool writes an incident note and a structured JSON payload with a prompt you can paste into any LLM to draft a ticket or stakeholder update.

## What the simulation shows (default scenario: Indian retail bank, OTP-phishing account takeover)

- A frozen model drops from about 89% to 63% of fraud value caught in the worst week.
- Drift-triggered retraining beats weekly retraining while using 2 retrains instead of 21.
- The bank's own monitor reacts about 19 days after the attack starts, and 10 of those days are label delay. Faster fraud confirmation is the cheapest speed-up.
- With peer banks hit 14 days earlier, the network-informed model goes live one day into the attack. A week in, it catches 12 of 17 attack transactions where the bank's own model catches 1.
- A festive-season traffic alarm triggers a challenger that does not beat the champion, so nothing ships. A calendar retrain would have deployed it anyway.

## Institutions and attacks

Presets: Indian retail bank, global card issuer, digital bank, card network (multi-issuer).
Attacks: account takeover via OTP phishing, synthetic identity bust-out, gift card cash-out.
Adjustable: attack day and size, label delay, alert budget, monitor sensitivity, festive spending spike, how far ahead peer banks were hit, and the cost of a false decline.

## How it works

- 3,000 sampled transactions a day over a 150-day timeline, with eight signals: amount, time of day, card present or not, device, velocity, merchant type, location match and account age.
- Model: logistic regression with pairwise feature interactions, retrained on the latest 45 days of labels that have actually arrived.
- Fraud rates are boosted in the sample so patterns are visible, then rescaled to each institution's real volume and fraud rate for money figures. Probabilities shown reflect the boosted sample.
- The simulation engine is in `sim.js` and is also embedded in `index.html`, which runs it in a web worker.

## Using it with real data

A bank would only need to export:

| Field | Used for |
|---|---|
| txn_id, txn_time, amount | Volume, value at risk, daily windows |
| model_score, model_version | Score drift and which model was live |
| decision | Catch rate, decline rate, false declines |
| fraud_label, label_date | Matured catch rate and the true label delay |
| feature snapshot (optional) | Explaining what changed in the fraud mix |

In production, the pieces map to standard tools: Kafka or Flink for scoring streams, Feast for features, MLflow for the registry and promotion gate, Evidently for drift reports, Airflow for retraining, SHAP for attribution.

## Run it locally

Download `index.html` and open it in Chrome or Safari. That's it.

## Limitations

This is a prototype on synthetic data. Real fraud models use far more signals, tree or neural models, and millisecond-latency serving. The point is the product logic: monitoring, gating, explainability and the economics of when to act.

---

Built by Vikash as an open product prototype.

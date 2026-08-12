# Budget module

Creates an alert-only monthly budget for one or more projects. Thresholds are
50%, 80%, and 100% of actual spend plus 100% of forecasted spend. No automatic
shutdown or resource mutation is configured.

The public input is `amount_cents`, a strictly positive integer. It is the sole
monetary source of truth. The module converts it exactly with:

```text
units = floor(amount_cents / 100)
nanos = (amount_cents % 100) * 10000000
```

The former decimal-dollar `amount` input is intentionally unsupported to avoid
binary floating-point loss during conversion to Google Cloud money nanos.

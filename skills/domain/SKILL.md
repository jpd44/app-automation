---
description: Check Route 53 domain availability, register if approved, and set up cross-account hosted zone delegation so the child account's CDK stack can manage DNS.
---

# /jpd-app-kit:domain — Route 53 domain + delegated hosted zone

## Why two accounts touch this

Domain **registration** lives in the management account (`mgt`, ID from `aws.mgt_account_id` in `~/.config/jpd-app-kit/config.json`) for consolidated billing. The **hosted zone** the CDK stack uses lives in the **child** account so the stack can `route53.HostedZone.fromLookup` it without cross-account roles. We bridge them with an NS delegation.

## Steps

### 1. Check availability

```bash
AWS_PROFILE=mgt aws route53domains check-domain-availability --domain-name "$DOMAIN"
```

If `AVAILABLE`, fetch the annual cost:
```bash
AWS_PROFILE=mgt aws route53domains list-prices --tld "$(echo $DOMAIN | awk -F. '{print $NF}')"
```

**Quote the price to the user and require explicit OK before registering.**

### 2. Register

```bash
AWS_PROFILE=mgt aws route53domains register-domain \
  --cli-input-json file://register-domain.json
```

`register-domain.json` should use the contact info on file for other domains in this AWS account (the user can pull it from `aws route53domains get-domain-detail --domain-name <existing-domain>`). If no other domains are registered, ask the user for contact info before submitting. Privacy protection: `AdminPrivacy=true`, `RegistrantPrivacy=true`, `TechPrivacy=true`. Auto-renew: `AutoRenew=true`.

Registration takes 15–60 minutes. Don't block — kick it off, record the `OperationId`, and let the user know they'll get an email.

### 3. Create the hosted zone in the **child** account

```bash
AWS_PROFILE=child-<app-name> aws route53 create-hosted-zone \
  --name "$DOMAIN" \
  --caller-reference "$(date +%s)"
```

Capture the four NS records from the response.

### 4. Delete the auto-created zone in `mgt` and replace its NS records with the child's

Registration auto-creates a hosted zone in `mgt`. Delete it, **or** (safer) keep it but update its NS record set to point at the child zone's nameservers so DNS resolution flows through the child zone.

```bash
# In mgt — replace NS values with the four from step 3
AWS_PROFILE=mgt aws route53 change-resource-record-sets \
  --hosted-zone-id "$MGT_ZONE_ID" \
  --change-batch file://ns-change.json
```

`ns-change.json`:
```json
{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "{{DOMAIN}}.",
      "Type": "NS",
      "TTL": 172800,
      "ResourceRecords": [
        {"Value": "ns-XXXX.awsdns-XX.com."},
        {"Value": "ns-XXXX.awsdns-XX.net."},
        {"Value": "ns-XXXX.awsdns-XX.org."},
        {"Value": "ns-XXXX.awsdns-XX.co.uk."}
      ]
    }
  }]
}
```

### 5. Update the registered domain to use the child-account nameservers

```bash
AWS_PROFILE=mgt aws route53domains update-domain-nameservers \
  --domain-name "$DOMAIN" \
  --nameservers Name=ns-XXXX.awsdns-XX.com Name=... Name=... Name=...
```

This makes the child zone authoritative for the public internet — the registrar delegates straight to it, no extra hop.

### 6. Verify

```bash
dig +short NS "$DOMAIN" @8.8.8.8
```

May take up to an hour to propagate after a fresh registration. Don't loop forever — tell the user to re-run later if it's still empty.

# Prompt injection handling

## Goal

Normalize how Popeye treats untrusted inbound content before it reaches tool-capable execution.

## Policy

- Scan all Telegram input before run creation.
- Classify outcomes as `allow`, `sanitize`, or `quarantine`.
- `allow`: create the run normally.
- `sanitize`: remove known instruction-override phrases, then create the run and record an audit event.
- `quarantine`: do not create a tool-capable run; emit an intervention and audit event.

## Minimum rule set

- Instruction override attempts
- Credential or secret exfiltration requests
- Approval/policy bypass attempts
- Known destructive shell abuse patterns

## Evidence

Every sanitize/quarantine action must leave an audit event with timestamp, rule names, and source metadata.

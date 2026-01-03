# Matrix HTTP API Bun Example

This examples shows the communication between Matrix account dedicated to a human and a bot
account in an unencrypted Matrix room.
This examples uses the HTTP API for Matrix since there is only a a working node.js SDK.
As of creating this example the using the Matrix SDK with Bun results in unresolvable dependency
issues with system-related crypto libraries.

This example is tested with a docker-based setup (for Matrix) behind a WireGuard VPN.

# Setup
Create a `.env` with your connection related information. 

## .env file
```ini
MATRIX_HOMESERVER=https://matrix.mopore.org
MATRIX_ROOM_ID=!lAqkoanigxgSGNfDzT:matrix.mopore.org
HUMAN_USER_ID=@jni:matrix.mopore.org
BOT_ACCESS_TOKEN=<your access token>
```

### Requesting the Access Token for the Bot Account
```shell
HS="https://matrix.mopore.org"
BOT_USER="<bot's user ID>"
BOT_PASS='<bot's password>'

curl -sS "$HS/_matrix/client/v3/login" \
  -H "Content-Type: application/json" \
  -d '{
    "type":"m.login.password",
    "identifier":{"type":"m.id.user","user":"'"$BOT_USER"'"},
    "password":"'"$BOT_PASS"'"
  }' | jq .access_token
```

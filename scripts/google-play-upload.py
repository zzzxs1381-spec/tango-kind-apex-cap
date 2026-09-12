#!/usr/bin/env python3
"""Upload a verified Android App Bundle through the official Google Play API.

The caller is responsible for creating the Play Console app and granting the
service account only the permissions needed for the selected track.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

SCOPE = "https://www.googleapis.com/auth/androidpublisher"
API = "https://androidpublisher.googleapis.com/androidpublisher/v3"
UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3"


def fail_response(response: requests.Response, action: str) -> None:
    try:
        detail: Any = response.json()
    except ValueError:
        detail = response.text[:2000]
    raise RuntimeError(f"{action} failed: HTTP {response.status_code}: {detail}")


def request_json(
    session: requests.Session,
    method: str,
    url: str,
    *,
    action: str,
    **kwargs: Any,
) -> dict[str, Any]:
    response = session.request(method, url, timeout=120, **kwargs)
    if not response.ok:
        fail_response(response, action)
    if not response.content:
        return {}
    return response.json()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-account", required=True, type=Path)
    parser.add_argument("--package", required=True)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--track", default="internal")
    parser.add_argument("--release-name", required=True)
    args = parser.parse_args()

    if not args.service_account.is_file():
        raise SystemExit("service account JSON does not exist")
    if not args.bundle.is_file() or args.bundle.stat().st_size == 0:
        raise SystemExit("AAB does not exist or is empty")
    if args.track not in {"internal", "alpha", "beta", "production"}:
        raise SystemExit(f"unsupported Play track: {args.track}")

    credentials = service_account.Credentials.from_service_account_file(
        str(args.service_account), scopes=[SCOPE]
    )
    credentials.refresh(Request())
    if not credentials.token:
        raise RuntimeError("Google authentication returned no access token")

    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {credentials.token}",
        "Accept": "application/json",
    })

    package = args.package
    edit = request_json(
        session,
        "POST",
        f"{API}/applications/{package}/edits",
        action="create edit",
        json={},
    )
    edit_id = str(edit.get("id", ""))
    if not edit_id:
        raise RuntimeError("Google Play returned an edit without an id")

    with args.bundle.open("rb") as bundle_file:
        uploaded = request_json(
            session,
            "POST",
            f"{UPLOAD_API}/applications/{package}/edits/{edit_id}/bundles?uploadType=media",
            action="upload bundle",
            headers={
                "Authorization": f"Bearer {credentials.token}",
                "Accept": "application/json",
                "Content-Type": "application/octet-stream",
            },
            data=bundle_file,
        )

    version_code = uploaded.get("versionCode")
    if version_code is None:
        raise RuntimeError(f"bundle upload returned no versionCode: {uploaded}")

    track_body = {
        "track": args.track,
        "releases": [
            {
                "name": args.release_name,
                "versionCodes": [str(version_code)],
                "status": "completed",
            }
        ],
    }
    request_json(
        session,
        "PUT",
        f"{API}/applications/{package}/edits/{edit_id}/tracks/{args.track}",
        action=f"update {args.track} track",
        json=track_body,
    )
    committed = request_json(
        session,
        "POST",
        f"{API}/applications/{package}/edits/{edit_id}:commit",
        action="commit edit",
        json={},
    )

    print(
        json.dumps(
            {
                "package": package,
                "track": args.track,
                "versionCode": version_code,
                "editId": committed.get("id", edit_id),
                "status": "committed",
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except requests.RequestException as exc:
        print(f"Google Play network error: {exc}", file=sys.stderr)
        raise SystemExit(2)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(3)

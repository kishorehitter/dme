import json
from django.shortcuts import render
from django.http import JsonResponse
from django.conf import settings

GITHUB_OWNER = 'kishorehitter'
GITHUB_REPO  = 'DME-releases'
PACKAGE_NAME = 'com.DME'

def download_app(request):
    """
    Download / invite landing page.
    Shows the app logo, description, and a direct APK download button.
    The download URL points to the latest GitHub release — same source the
    in-app updater already uses, so it is always up to date.
    """
    github_latest_url = (
        f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
    )
    context = {
        'github_latest_url': github_latest_url,
    }
    return render(request, 'download_page.html', context)


def assetlinks_json(request):
    """
    /.well-known/assetlinks.json

    Android uses this file to verify that this server belongs to the app
    identified by PACKAGE_NAME.  Without it, the OS will NOT intercept
    the /invite link and open the app automatically.

    HOW TO GET YOUR SHA-256:
      In DME/android run:  ./gradlew signingReport
      Copy the SHA-256 line from the *release* (or debug) variant.
    """
    # Read the production host dynamically from ALLOWED_HOSTS so there is
    # nothing hardcoded here — same as the rest of the backend.
    production_host = next(
        (h for h in settings.ALLOWED_HOSTS if 'render.com' in h or ('.' in h and h != 'localhost')),
        None
    )

    data = [{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": PACKAGE_NAME,
            # ── PASTE YOUR RELEASE SHA-256 HERE ──────────────────────────────
            # Format: "AB:CD:EF:..." (colon-separated uppercase hex)
            "sha256_cert_fingerprints": [
                "41:E6:4D:35:A7:31:B7:5F:4A:12:0D:D7:74:2E:78:1C:9D:E1:DD:95:32:69:C9:44:81:43:2F:68:F7:E7:92:B4"
            ]
        }
    }]
    return JsonResponse(data, safe=False, content_type='application/json')


def trivia_challenge_redirect(request, token):
    """
    Redirect page for trivia challenge links.
    When opened in a browser it shows a landing page.
    When opened in the app via App Links it is intercepted and handled by the React Native app.
    """
    from trivia.models import TriviaChallenge
    try:
        challenge = TriviaChallenge.objects.get(token=token)
        if challenge.is_used:
            status_text = 'already_used'
        elif challenge.is_expired:
            status_text = 'expired'
        else:
            status_text = 'valid'
    except TriviaChallenge.DoesNotExist:
        status_text = 'not_found'

    return render(request, 'trivia_challenge.html', {
        'token': str(token),
        'status': status_text,
        'app_link': f'dme://trivia/challenge/{token}',
    })

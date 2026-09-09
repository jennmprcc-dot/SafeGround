/**
 * Voice webhook for the MPRCC Twilio toll-free number (voice side).
 *
 * The number's Voice webhook points here (POST; GET returns the same TwiML
 * so a reviewer hitting the URL in a browser sees the message). Instead of
 * Twilio's demo greeting, callers hear a short MPRCC message that directs
 * them to text — this line is for SMS. Always returns 2xx TwiML.
 */
import { createFileRoute } from "@tanstack/react-router";

const VOICE_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<Response><Say voice="alice">Thanks for calling Marin Peer Resource ' +
  "Community Collective. This number is for text messages only. Please send " +
  "us a text message instead. If this is an emergency, please call nine one " +
  "one. Goodbye.</Say></Response>";

function voice(c: { request: Request }) {
  return new Response(VOICE_TWIML, {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
}

export const Route = createFileRoute("/api/voice")({
  server: {
    handlers: {
      GET: voice,
      POST: voice,
    },
  },
});
<?php
// api/chat.php — OPTIONAL: server-side proxy to an AI API (e.g., OpenAI).
// SECURITY: Never commit your API key to client-side JS.
// This is a stub. Fill in OPENAI_API_KEY via environment or Hostinger hPanel.

header('Content-Type: application/json');

$input = json_decode(file_get_contents('php://input'), true);
$userMessage = $input['message'] ?? '';

if (!$userMessage) {
  echo json_encode([ 'reply' => 'Say something like: mixes, shows, book, about, contact.' ]);
  exit;
}

// Example of where you would call OpenAI (commented out).
// $apiKey = getenv('OPENAI_API_KEY');
// if (!$apiKey) {
//   echo json_encode([ 'reply' => 'Server not configured with API key.' ]);
//   exit;
// }
//
// $payload = [
//   'model' => 'gpt-4o-mini',
//   'messages' => [
//     ['role' => 'system', 'content' => 'You are a DJ site mascot. Keep answers concise. When relevant, return {"intent":"mixes"} etc. as JSON.'],
//     ['role' => 'user', 'content' => $userMessage],
//   ],
// ];
// // Use cURL to POST to OpenAI with $apiKey...
// // Then echo back a JSON like: { reply: "...", intent: "mixes" }

// For now, a dumb rule-based reply:
$lower = strtolower($userMessage);
$reply = "I'm the DJ mascot. Try 'mixes', 'shows', 'book', 'about', or 'contact'.";
$intent = null;
foreach (['mixes','shows','book','about','contact'] as $k) {
  if (strpos($lower, $k) !== false) { $intent = $k; break; }
}

echo json_encode([ 'reply' => $reply, 'intent' => $intent ]);

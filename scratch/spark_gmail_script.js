/**
 * Daily Robotics — Google Apps Script
 * Monitors Gmail for the Daily Robotics Digest email and sends it to the webhook.
 * 
 * SETUP:
 *   1. Paste this entire file into script.google.com
 *   2. Set WEBHOOK_URL to your deployed Vercel endpoint
 *   3. Add a time-driven trigger: checkForNewDigest → every 15 minutes
 */

var WEBHOOK_URL = 'https://daily-robotics.vercel.app/api/webhook/spark';
var SEARCH_QUERY = 'subject:"Daily Robotics" is:unread';

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
function checkForNewDigest() {
  var threads = GmailApp.search(SEARCH_QUERY, 0, 5);
  if (!threads || threads.length === 0) {
    Logger.log('[Spark] No new digest emails found.');
    return;
  }

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var message = messages[j];
      if (!message.isUnread()) continue;

      var subject = message.getSubject();
      var htmlBody = message.getBody(); // Full HTML body

      Logger.log('[Spark] Processing email: ' + subject);

      // Convert the HTML body to clean markdown-style plain text
      var plainText = convertHtmlToText(htmlBody);

      Logger.log('[Spark] Converted text length: ' + plainText.length);
      Logger.log('[Spark] Preview:\n' + plainText.substring(0, 500));

      // Send the converted text to the webhook
      var success = sendToWebhook(plainText, subject);

      if (success) {
        message.markRead();
        Logger.log('[Spark] Email marked as read after successful webhook delivery.');
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HREF EXTRACTION — robust, handles all Gmail anchor tag formats
// ─────────────────────────────────────────────────────────────────────────────
function extractHref(aTagHtml) {
  // Try double-quoted href (most common)
  var m = aTagHtml.match(/\bhref\s*=\s*"([^"]*)"/i);
  if (m && m[1] && m[1] !== '#' && m[1] !== 'javascript:void(0)') {
    return decodeHtmlEntities(m[1]);
  }

  // Try single-quoted href
  m = aTagHtml.match(/\bhref\s*=\s*'([^']*)'/i);
  if (m && m[1] && m[1] !== '#' && m[1] !== 'javascript:void(0)') {
    return decodeHtmlEntities(m[1]);
  }

  // Try data-saferedirecturl (Gmail-specific: the real destination)
  m = aTagHtml.match(/\bdata-saferedirecturl\s*=\s*"([^"]*)"/i);
  if (m && m[1]) {
    return decodeHtmlEntities(m[1]);
  }

  // Try unquoted href (rare fallback)
  m = aTagHtml.match(/\bhref\s*=\s*([^\s>"']+)/i);
  if (m && m[1] && m[1] !== '#') {
    return decodeHtmlEntities(m[1]);
  }

  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML TO CLEAN TEXT CONVERSION
// ─────────────────────────────────────────────────────────────────────────────
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, function(_, code) {
      return String.fromCharCode(parseInt(code, 10));
    });
}

function convertHtmlToText(html) {
  var text = html;

  // 1. Decode HTML entities first so hrefs are clean
  text = decodeHtmlEntities(text);

  // 2. Replace block-level elements with newlines
  text = text.replace(/<\/?(p|div|section|article|header|footer|h[1-6]|li|tr)[^>]*>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

  // 3. Convert <a href="...">text</a> to [text](url) or just text if no URL
  text = text.replace(/<a\s[^>]*>([\s\S]*?)<\/a>/gi, function(fullMatch, innerHtml) {
    var href = extractHref(fullMatch);
    var linkText = innerHtml.replace(/<[^>]*>/g, '').trim();
    
    if (!linkText) return '';

    // If href is a real URL, format as markdown link
    if (href && (href.indexOf('http') === 0 || href.indexOf('//') === 0)) {
      return '[' + linkText + '](' + href + ')';
    }

    // If the link text IS a URL itself, use it as the href too  
    if (linkText.indexOf('http') === 0) {
      return '[' + linkText + '](' + linkText + ')';
    }

    // No valid URL: just return the text
    return linkText;
  });

  // 4. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // 5. Decode any remaining entities that appeared after tag stripping
  text = decodeHtmlEntities(text);

  // 6. Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{4,}/g, '\n\n\n');

  return text.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK DELIVERY
// ─────────────────────────────────────────────────────────────────────────────
function sendToWebhook(text, subject) {
  try {
    var payload = JSON.stringify({
      text: text,
      subject: subject || 'Daily Robotics Digest',
      source: 'gmail-spark'
    });

    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    var code = response.getResponseCode();
    var responseText = response.getContentText();

    Logger.log('[Spark] Webhook response: ' + code + ' — ' + responseText);

    if (code >= 200 && code < 300) {
      Logger.log('[Spark] Webhook delivered successfully.');
      return true;
    } else {
      Logger.log('[Spark] Webhook delivery failed with status: ' + code);
      return false;
    }
  } catch (e) {
    Logger.log('[Spark] Exception during webhook delivery: ' + e.toString());
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST HELPER — run this manually from the Apps Script editor to verify output
// ─────────────────────────────────────────────────────────────────────────────
function testWithLatestEmail() {
  var threads = GmailApp.search('subject:"Daily Robotics"', 0, 1);
  if (!threads.length) {
    Logger.log('No email found for testing.');
    return;
  }
  var msg = threads[0].getMessages()[0];
  var result = convertHtmlToText(msg.getBody());
  Logger.log('=== CONVERTED TEXT ===\n' + result);
}

import { useSyncExternalStore } from 'react';
import { useSession } from './session';

// Screen language for staff. Everything saved to the database stays English (item ids, English reasons);
// this only changes what the person sees on their own phone.
const KEY = 'compass-lang';
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

const HI: Record<string, string> = {
  'Back': 'पीछे', 'Categories': 'श्रेणियाँ', 'Back to categories': 'श्रेणियों पर वापस',
  '{where} indent': '{where} इंडेंट', 'For {day}': '{day} के लिए', 'tomorrow': 'कल',
  'Find an item': 'सामान ढूँढें', 'Type a few letters': 'कुछ अक्षर लिखें', 'My usual': 'मेरा रोज़ का',
  'Fills in after your first few indents': 'कुछ इंडेंट के बाद भर जाएगा', '{n} items you ask for often': '{n} सामान जो आप अक्सर माँगते हैं',
  'item': 'सामान', 'items': 'सामान', 'items chosen': 'सामान चुने', 'item chosen': 'सामान चुना',
  'Review and send': 'देखें और भेजें', 'Nothing needed': 'कुछ नहीं चाहिए',
  'Tell the store you need nothing for tomorrow?': 'स्टोर को बताएँ कि कल कुछ नहीं चाहिए?',
  'Check your indent': 'अपना इंडेंट देखें', 'Send to store': 'स्टोर को भेजें', 'Sending…': 'भेज रहे हैं…',
  'One item is well above your usual. Tell the store why.': 'एक सामान आपके रोज़ से बहुत ज़्यादा है। स्टोर को कारण बताएँ।',
  '{n} items are well above your usual. Tell the store why.': '{n} सामान आपके रोज़ से बहुत ज़्यादा हैं। स्टोर को कारण बताएँ।',
  'More than your usual. Why?': 'रोज़ से ज़्यादा है। क्यों?', 'Why more than usual': 'रोज़ से ज़्यादा क्यों',
  'Guests or event': 'मेहमान या कार्यक्रम', 'Running low': 'कम पड़ रहा है', 'Spoiled or wasted': 'ख़राब या बर्बाद हुआ', 'New dish': 'नया पकवान', 'Other': 'दूसरा कारण',
  'in {unit}': '{unit} में', 'Usual {q}': 'रोज़ का {q}', 'Last {q}': 'पिछली बार {q}',
  'No item with that name on your counter.': 'आपके काउंटर पर इस नाम का कोई सामान नहीं है।', 'Nothing here yet.': 'यहाँ अभी कुछ नहीं है।',
  'Search': 'खोज', 'Loading…': 'लोड हो रहा है…', 'No counter is set up for you yet.': 'आपके लिए अभी कोई काउंटर नहीं बना है।',
  'Opens {time}, you can start now': '{time} पर खुलेगा, आप अभी शुरू कर सकते हैं',
  'Open until {time}': '{time} तक खुला है', 'Past {time}, send as soon as you can': '{time} निकल गया, जल्दी भेजें',
  'The store is working on this indent.': 'स्टोर इस इंडेंट पर काम कर रहा है।',
  'You told the store you need nothing. Sent {time}.': 'आपने स्टोर को बताया कि कुछ नहीं चाहिए। {time} पर भेजा।',
  'Sent to the store at {time}.': '{time} पर स्टोर को भेजा गया।', 'Change something': 'कुछ बदलें', 'Sent to the store': 'स्टोर को भेज दिया',
  'Remove': 'हटाएँ', 'Less': 'कम', 'More': 'ज़्यादा', 'Type amount': 'मात्रा लिखें',
  // home
  'Hello, {name}': 'नमस्ते, {name}', 'Indent for {day}': '{day} का इंडेंट', 'Sign out': 'साइन आउट',
  'Indent time is on. Please send by {time}.': 'इंडेंट का समय चल रहा है। कृपया {time} तक भेजें।',
  'Indent time starts at {time}. You can start earlier.': 'इंडेंट का समय {time} से शुरू होगा। आप पहले भी शुरू कर सकते हैं।',
  'Indent time was until {time}. Please send now if you have not.': 'इंडेंट का समय {time} तक था। अगर नहीं भेजा तो अभी भेजें।',
  'Sent {time}': '{time} पर भेजा', 'Started, not sent': 'शुरू किया, भेजा नहीं', 'Make the indent': 'इंडेंट बनाएँ', 'Sent': 'भेजा', 'Open': 'खोलें',
  'Receiving, counting and waste come next.': 'सामान लेना, गिनती और बर्बादी आगे आएगा।',
  // SOS
  'SOS': 'SOS', 'Need something right now?': 'अभी कुछ चाहिए?', 'Your SOS': 'आपका SOS',
  'This makes a loud alarm on the store phone. Use it only when you really cannot wait.': 'इससे स्टोर के फ़ोन पर तेज़ अलार्म बजता है। सिर्फ़ तब इस्तेमाल करें जब बिल्कुल इंतज़ार न हो सके।',
  'Which item? (you can skip this)': 'कौन सा सामान? (छोड़ सकते हैं)', 'Change': 'बदलें',
  'Finished': 'ख़त्म हो गया', 'Almost over': 'लगभग ख़त्म', 'Need it now': 'अभी चाहिए', 'Wrong item came': 'ग़लत सामान आया',
  'Anything else to tell the store?': 'स्टोर को और कुछ बताना है?', 'Optional': 'ज़रूरी नहीं', 'Send SOS to the store': 'स्टोर को SOS भेजें',
  'SOS sent to the store': 'स्टोर को SOS भेज दिया', 'Request': 'अनुरोध', 'Sent at {time}': '{time} पर भेजा',
  'The store is on it.': 'स्टोर इस पर काम कर रहा है।', 'The store is on it. About {n} minutes.': 'स्टोर इस पर काम कर रहा है। लगभग {n} मिनट।',
  'No answer from the store yet. The owner is being alerted too. You can also call.': 'स्टोर से अभी जवाब नहीं आया। मालिक को भी बताया जा रहा है। आप फ़ोन भी कर सकते हैं।',
  'Waiting for the store to answer…': 'स्टोर के जवाब का इंतज़ार…', 'Call {name}': '{name} को फ़ोन करें',
  'I got it, close this': 'मिल गया, इसे बंद करें', 'Cancel, no longer needed': 'रद्द करें, अब ज़रूरत नहीं',
  // voice
  'Speak your order': 'बोलकर ऑर्डर करें', "I'm listening": 'मैं सुन रहा हूँ',
  'Say the item and quantity, for example: "onion 5 kg, tomato 10 kg"': 'सामान और मात्रा बोलें, जैसे: "प्याज़ 5 किलो, टमाटर 10 किलो"',
  'Tap the red button when you finish': 'बोलना ख़त्म होने पर लाल बटन दबाएँ', 'Cancel': 'रद्द करें',
  'Did I hear this right?': 'क्या मैंने सही सुना?', 'Nothing is added until you tap Add': 'जब तक आप जोड़ें नहीं दबाते, कुछ नहीं जुड़ेगा',
  'Add to my indent': 'मेरे इंडेंट में जोड़ें', 'Speak again': 'फिर से बोलें', 'Heard: {text}': 'सुना: {text}',
  'I could not match these. Please add them by hand:': 'ये मैं नहीं पहचान पाया। कृपया हाथ से जोड़ें:',
  'Nothing understood. Try again, a little slower.': 'कुछ समझ नहीं आया। थोड़ा धीरे बोलकर फिर कोशिश करें।',
  'Voice is not available on this phone. Use the search box and the keyboard microphone.': 'इस फ़ोन पर आवाज़ की सुविधा नहीं है। खोज बॉक्स और कीबोर्ड का माइक इस्तेमाल करें।',
  'Could not use the microphone. Please allow it in the browser.': 'माइक इस्तेमाल नहीं हो सका। कृपया ब्राउज़र में अनुमति दें।',
  'Added {n} items by voice': 'आवाज़ से {n} सामान जुड़े'
};

const GROUPS_HI: Record<number, string> = {
  1: 'सब्ज़ी और फल', 2: 'डेयरी और अंडे', 3: 'चिकन और मछली', 4: 'आटा, चावल और दाल', 5: 'मसाले, सॉस और तेल', 6: 'सॉस और स्प्रेड',
  7: 'फ्रोज़न और स्नैक्स', 8: 'किचन में बना', 9: 'ब्रेड और बेकरी', 10: 'ड्रिंक्स, सिरप और जूस', 11: 'आइसक्रीम', 12: 'पैकेजिंग और डिस्पोजेबल',
  13: 'सफाई और किचन केयर', 14: 'गैस और कोयला', 15: 'स्टेशनरी और अन्य', 16: 'मेवे और ड्राई फ्रूट'
};
const UNIT_HI: Record<string, string> = { kg: 'किलो', L: 'लीटर', pkt: 'पैकेट', pcs: 'नग', bottle: 'बोतल', tray: 'ट्रे', bunch: 'गुच्छा', roll: 'रोल', tub: 'टब', box: 'डिब्बा', g: 'ग्राम', ml: 'मिली' };

export function useLang() {
  const { profile } = useSession();
  const extra = profile?.extra_language ?? null;
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const local = !!extra && stored !== 'en';
  const hi = extra === 'hi' && local;
  const toggle = () => { try { localStorage.setItem(KEY, hi ? 'en' : 'local'); } catch { /* ignore */ } listeners.forEach((f) => f()); };
  const t = (s: string, v?: Record<string, string | number>) => {
    let out = hi ? (HI[s] ?? s) : s;
    if (v) for (const [k, val] of Object.entries(v)) out = out.split(`{${k}}`).join(String(val));
    return out;
  };
  const unit = (u: string) => (hi ? UNIT_HI[u] ?? u : u);
  const group = (id: number, name: string) => (hi ? GROUPS_HI[id] ?? name : name);
  // Can this person switch screen language at all?
  return { hi, local, extra, toggle, t, unit, group, canSwitch: !!extra };
}

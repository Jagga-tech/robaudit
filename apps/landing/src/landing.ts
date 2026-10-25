// Page 1 behaviour: Figma "07 — Landing Page", frames 01 Hero (63:62), 02 Meet Summo + QR (78:214), 03 Handoff (78:266).
import { convex, api } from './lib/convex';

declare const qrcode: any; // qrcode-generator 1.4.4, classic script from cdnjs (index.html)

// The QR encodes the phone page this laptop is actually serving (docs/frontend-guide.md §2).
var PHONE_URL = location.origin + "/phone";
var ICON: Record<string, string> = {
  note:"M4 5h16v10H9l-5 4z",
  readers:"M12 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 8v4l3 2M3 12h2M19 12h2",
  phone:"M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  calc:"M5 3h14v18H5zM8 7h8M8 12h3M13 12h3M8 16h3M13 16h3",
  check:"M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4"
};
// The real demo beats, in order (docs/demo-flow.md).
var ROWS = [
  {t:'Matt: "another 200k to finish"', a:"Site note v1, from the phone page", tag:"", ic:"note"},
  {t:"$200,000 read, wording ambiguous", a:"Claude + Gemini", tag:"ambiguous", ic:"readers"},
  {t:"Calling Matt: additional or new total?", a:"Cartesia voice call", tag:"ringing", ic:"phone"},
  {t:"Revenue $500,000 to $400,000", a:"Accounting engine", tag:"−$100,000", ic:"calc"},
  {t:"Proposal rev 2 waits for Dana", a:"Controller approval, posting locked", tag:"", ic:"check"}
];
var N = ROWS.length, CENTER = 2;
var list = document.getElementById("feedList")!;
function card(r: typeof ROWS[number]){
  var li = document.createElement("li"); li.className = "card";
  li.innerHTML = '<div class="ibox"><svg viewBox="0 0 24 24"><path d="'+ICON[r.ic]+'"/></svg></div>'+
    '<div><b>'+r.t+'</b><i><svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>'+r.a+'</i></div>'+
    '<span class="tag">'+r.tag+'</span>';
  return li;
}
ROWS.concat(ROWS).forEach(function(r){ list.appendChild(card(r)); }); // two copies so the loop snaps back invisibly
var cards = list.children as HTMLCollectionOf<HTMLElement>, step = 0;
function stepPx(){ return cards[0].offsetHeight + (parseFloat(getComputedStyle(list).rowGap) || 10); }
function paint(){
  for (var i = 0; i < cards.length; i++){
    var d = Math.abs(i - (step + CENTER));
    cards[i].className = "card" + (d === 0 ? " active" : d === 1 ? " near" : "");
  }
}
function advance(){
  step++;
  list.style.transform = "translateY(" + (-step * stepPx()) + "px)";
  paint();
  if (step === N){
    setTimeout(function(){
      list.classList.add("snap"); step = 0;
      list.style.transform = "translateY(0)"; paint();
      void list.offsetHeight; list.classList.remove("snap");
    }, 720);
  }
}
paint();
var timer = setInterval(advance, 2300);
document.addEventListener("visibilitychange", function(){
  clearInterval(timer); if (!document.hidden) timer = setInterval(advance, 2300);
});

try {
  var q = qrcode(0, "M"); q.addData(PHONE_URL); q.make();
  document.getElementById("qr")!.innerHTML = q.createSvgTag({cellSize: 4, margin: 0, scalable: true}).replace(/fill="black"/g, 'fill="#263336"');
} catch (e) { document.getElementById("qr")!.textContent = "QR unavailable"; }
document.getElementById("qrUrl")!.textContent = PHONE_URL.replace(/^https?:\/\//, "");

// Summo flies from the panel to the centre of the page, lands, the banner unfolds behind him, the page blurs.
var pageEl = document.getElementById("page")!, stage = document.getElementById("stage")!, poster = document.getElementById("poster")!;
var summo = document.getElementById("summo")!, fly = document.getElementById("summoStage")!;
var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, busy = false, isOpen = false;
var HOP = innerWidth > 560 ? 225 : 0; // how far Summo rises so his head shows above the banner
function setTravel(){ fly.style.setProperty("--travel", Math.max(0, poster.offsetWidth / 2 - 150) + "px"); }
setTravel(); addEventListener("resize", setTravel);
function offsetFromCentre(){
  var r = summo.getBoundingClientRect();
  var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return { dx: cx - innerWidth / 2, dy: cy - innerHeight / 2, s: r.width / fly.getBoundingClientRect().width || 0.68 };
}
function setVars(o: { dx: number; dy: number; s: number }){ fly.style.setProperty("--dx", o.dx + "px"); fly.style.setProperty("--dy", o.dy + "px"); fly.style.setProperty("--s", String(o.s)); }
function openPoster(){
  if (busy || isOpen) return;
  busy = true; isOpen = true;
  stage.hidden = false; setTravel(); // measure the banner once it is in layout
  if (reduce){ setVars({ dx: 0, dy: -HOP, s: 1 }); stage.classList.add("on", "open"); pageEl.classList.add("blur"); summo.style.visibility = "hidden"; poster.setAttribute("aria-hidden", "false"); busy = false; return; }
  fly.classList.remove("fly", "hop");
  setVars(offsetFromCentre());            // start exactly where he stands in the panel
  void fly.offsetWidth;
  summo.style.visibility = "hidden";
  fly.classList.add("fly"); setVars({ dx: 0, dy: 0, s: 1 }); // fly to the centre
  stage.classList.add("on"); pageEl.classList.add("blur");
  setTimeout(function(){ fly.classList.remove("fly"); fly.classList.add("hop"); setVars({ dx: 0, dy: -HOP, s: 1 }); }, 760); // hop up behind the banner
  setTimeout(function(){ stage.classList.add("open"); poster.setAttribute("aria-hidden", "false"); busy = false; }, 880);
}
function closePoster(){
  if (busy || !isOpen) return;
  busy = true; isOpen = false;
  stage.classList.remove("open"); poster.setAttribute("aria-hidden", "true");
  if (reduce){ stage.classList.remove("on"); pageEl.classList.remove("blur"); summo.style.visibility = ""; stage.hidden = true; busy = false; return; }
  setTimeout(function(){
    fly.classList.remove("hop"); fly.classList.add("fly"); setVars(offsetFromCentre()); // fly back to the panel
    stage.classList.remove("on"); pageEl.classList.remove("blur");
    setTimeout(function(){ summo.style.visibility = ""; stage.hidden = true; fly.classList.remove("fly"); busy = false; }, 760);
  }, 350);
}
document.getElementById("joinBtn")!.addEventListener("click", openPoster);
summo.addEventListener("click", openPoster);
fly.addEventListener("click", closePoster);
document.getElementById("scrim")!.addEventListener("click", closePoster);
document.getElementById("closeBtn")!.addEventListener("click", closePoster);
document.addEventListener("keydown", function(e: KeyboardEvent){ if (e.key === "Escape") closePoster(); });
setTimeout(openPoster, 2600); // play the moment once on load
// Scroll also drives it: down past the hero opens, back to the top closes.
var scrollTick = false;
addEventListener("scroll", function(){
  if (scrollTick) return; scrollTick = true;
  requestAnimationFrame(function(){
    scrollTick = false;
    if (scrollY > 140 && !isOpen) openPoster();
    else if (scrollY < 40 && isOpen) closePoster();
  });
}, { passive: true });

// 02 → 03 handoff (docs/frontend-guide.md "Scroll story and handoff"): the judge joins on the phone, no laptop click.
var joined = document.getElementById("joined")!, seen: string | null | undefined, handing = false;
convex.onUpdate(api.managers.current, {}, function(m){
  if (seen === undefined){ seen = m ? m._id : null; return; } // a manager already joined before this page loaded is not a new judge
  if (!m || m._id === seen || handing) return;
  seen = m._id; handing = true;
  joined.textContent = m.name + " joined as deployment manager";
  if (!isOpen) openPoster();
  setTimeout(handoff, isOpen && !busy ? 0 : 900); // let the banner finish opening first
});
function handoff(){
  busy = true;
  stage.classList.remove("open"); poster.setAttribute("aria-hidden", "true"); // banner folds away
  stage.classList.add("on"); pageEl.classList.add("blur"); stage.hidden = false; summo.style.visibility = "hidden";
  fly.classList.remove("fly", "hop"); fly.classList.add("handoff"); setVars({ dx: 0, dy: 0, s: 1 }); // settle at the centre
  stage.classList.add("handing");
  setTimeout(function(){ location.href = "/workbench"; }, 1600);
}

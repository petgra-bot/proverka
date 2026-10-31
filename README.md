# Prověrka nemovitosti – testovací stránka

Krok 1: identifikace nemovitosti z adresy nebo odkazu na inzerát (Sreality) nad veřejnými službami RÚIAN (ČÚZK).
Běží celé v prohlížeči, nic neukládá. Web: https://proverka.gratzer.cz (neindexovaný test).

## Sreality a výběr domu na mapě

Sreality v `robots.txt` zakazují automatické čtení všem kromě vyhledávačů, proto je skript na Cloudflaru nečte.
Hlavní vstup je adresa. Z odkazu na Sreality známe jen ulici: stránka ukáže letecký snímek ČÚZK s obrysy domů
v ulici, které sedí typem, a zákazník klepne na dům podle fotek z inzerátu (`vyberNaMape` v `app.js`).

Určení domu z údajů inzerátu (Bezrealitky, iDNES; `najdiBudovuZInzeratu`): kód RÚIAN → číslo domu → body za typ,
špendlík na budově (do 5 m) a shodu výměry pozemku se stavební parcelou a nejvýš dvěma sousedními parcelami
(tolerance 0,5 %). Test na 41 domech ze Sreality se známou adresou (číslo domu skryté): se špendlíkem 36 správně,
0 špatně; jen s ulicí 10 správně, 1 špatně. Nejisté případy jdou na výběr na mapě.

Záložka „Prověřit“ (čtení inzerátu v prohlížeči uživatele) je vyřazená a uložená v `archiv/zalozka/`.

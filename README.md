# Prověrka nemovitosti – testovací stránka

Krok 1: identifikace nemovitosti z adresy nebo odkazu na inzerát (Sreality) nad veřejnými službami RÚIAN (ČÚZK).
Běží celé v prohlížeči, nic neukládá. Web: https://proverka.gratzer.cz (neindexovaný test).

## Sreality a záložka „Prověřit“

Sreality v `robots.txt` zakazují automatické čtení všem kromě vyhledávačů, proto je skript na Cloudflaru nečte.
Inzerát ze Sreality (i Bezrealitek a iDNES) přečte záložka „Prověřit“ (`zalozka()` v `app.js`) v prohlížeči uživatele
a předá údaje stránce v části adresy za `#inzerat=` (na server se neposílá).

Určení domu z údajů inzerátu (`najdiBudovuZInzeratu`): kód RÚIAN → číslo domu → body za typ a podlaží, špendlík na budově
(do 5 m) a shodu výměry pozemku se stavební parcelou a nejvýš dvěma sousedními parcelami (tolerance 0,5 %).
Test na 41 domech ze Sreality se známou adresou (číslo domu skryté): se špendlíkem 36 správně, 0 špatně;
jen s ulicí 10 správně, 1 špatně, 14× správný dům v nabídce.

# Generalkarte 1:200 000 на всю Угорщину

Скрипти, якими 2026-11-19 зроблено серію `generalkarte-200000` (`public/maps/generalkarte/*.webp`,
`public/maps/generalkarte-overview.webp`, `data/maps/generalkarte-*.json`). Робоча тека — `GK_WORK`
(типово `scripts/georef/generalkarte/work`, у git не йде).

1. `need.json` — 24 аркуші (34°–41° сх. від Ферро × 46°–49° пн. ш.), що перетинають сучасну Угорщину
   або містять прикордонні місця проєкту; назви файлів з категорії Commons
   «3rd Military Mapping Survey of Austria-Hungary» (скани László Zentai, ELTE).
2. `dl.py` — мініатюри 3840 px з thumb.wikimedia.org (оригінали 3400–3500 px; upload.wikimedia.org віддає 429).
3. `gkdetect.py` — рамка на копіях шириною 3300 px (`work/r3300/`): зовнішня лінія → смуга підписів →
   смуга поділок, межа = внутрішня лінія; 10 відрізків на сторону, крива; результат `gk_det.json`.
4. `gkwarp.py` — TPS за 8 точками в проєкцію Web Mercator точно на межах аркуша з поправкою зсуву
   (−0,000965°, −0,00074°), WebP 2200 px заввишки, якість 72; оглядова мозаїка (зум 8,6).

// Вивантаження файлів з браузера: зберегти на пристрій або передати в іншу програму (меню «Поділитися»).

const UK_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia',
  ы: 'y', э: 'e', ъ: '', ё: 'e',
};
/**
 * Назва файлу латинкою без пробілів: «Поле біля Дунаю, ранок» → «Pole-bilia-Dunaiu-ranok». Назви кирилицею
 * частина браузерів і програм під час збереження чи передавання замінює на безлике «download».
 */
export function asciiName(s: string, fallback: string): string {
  const lat = [...s].map((ch) => {
    const low = ch.toLowerCase();
    const r = UK_LAT[low];
    if (r === undefined) return ch;
    return ch === low ? r : r.charAt(0).toUpperCase() + r.slice(1);
  }).join('');
  const clean = lat.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  return clean || fallback;
}

/** Зберігає файл на пристрій (звичайне завантаження браузера). */
export function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Чи вміє браузер передати цей файл через «Поділитися» (на телефонах зазвичай так, на ПК — ні). */
export function canShareFile(file: File): boolean {
  try { return !!navigator.canShare?.({ files: [file] }); } catch { return false; }
}

/** Відкриває меню «Поділитися» з файлом; відмову людини не вважаємо помилкою. */
export function shareFile(file: File, title: string): void {
  void navigator.share({ files: [file], title }).catch(() => undefined);
}

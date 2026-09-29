// LiveX AI City — "Route 7". The 60-second edit.
import { SCENES_HUMAN } from './s1_human.js';
import { SCENES_MEET } from './s2_meet.js';
import { SCENES_JOURNEY } from './s3_journey.js';
import { SCENES_CITY } from './s4_city.js';
import { SCENES_FINAL } from './s5_final.js';

export async function setup(film) {
  for (const s of [...SCENES_HUMAN, ...SCENES_MEET, ...SCENES_JOURNEY, ...SCENES_CITY, ...SCENES_FINAL]) film.add(s);
}

/**
 * Opt-in "Playing …" detection. Running executable names are matched against this list plus the
 * user's own additions. Only the matched game's display name is ever shared, never the process list.
 */
export const KNOWN_GAMES: Record<string, string> = {
  'valorant-win64-shipping.exe': 'VALORANT',
  'leagueoflegends.exe': 'League of Legends',
  'league of legends.exe': 'League of Legends',
  'cs2.exe': 'Counter-Strike 2',
  'dota2.exe': 'Dota 2',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'minecraft.windows.exe': 'Minecraft',
  'robloxplayerbeta.exe': 'Roblox',
  'gta5.exe': 'Grand Theft Auto V',
  'gta5_enhanced.exe': 'Grand Theft Auto V',
  'rdr2.exe': 'Red Dead Redemption 2',
  'r5apex.exe': 'Apex Legends',
  'r5apex_dx12.exe': 'Apex Legends',
  'overwatch.exe': 'Overwatch 2',
  'rocketleague.exe': 'Rocket League',
  'eldenring.exe': 'ELDEN RING',
  'cod.exe': 'Call of Duty',
  'cod24-cod.exe': 'Call of Duty',
  'modernwarfare.exe': 'Call of Duty: Modern Warfare',
  'tslgame.exe': 'PUBG: BATTLEGROUNDS',
  'rainbowsix.exe': 'Rainbow Six Siege',
  'rainbowsix_be.exe': 'Rainbow Six Siege',
  'destiny2.exe': 'Destiny 2',
  'wow.exe': 'World of Warcraft',
  'hearthstone.exe': 'Hearthstone',
  'diablo iv.exe': 'Diablo IV',
  'pathofexile_x64steam.exe': 'Path of Exile',
  'pathofexile.exe': 'Path of Exile',
  'pathofexile2.exe': 'Path of Exile 2',
  'cyberpunk2077.exe': 'Cyberpunk 2077',
  'witcher3.exe': 'The Witcher 3',
  'bg3.exe': "Baldur's Gate 3",
  'bg3_dx11.exe': "Baldur's Gate 3",
  'helldivers2.exe': 'HELLDIVERS 2',
  'deadlock.exe': 'Deadlock',
  'marvel-win64-shipping.exe': 'Marvel Rivals',
  'terraria.exe': 'Terraria',
  'stardew valley.exe': 'Stardew Valley',
  'among us.exe': 'Among Us',
  'phasmophobia.exe': 'Phasmophobia',
  'lethal company.exe': 'Lethal Company',
  'factorio.exe': 'Factorio',
  'rust.exe': 'Rust',
  'rustclient.exe': 'Rust',
  'fallguys_client_game.exe': 'Fall Guys',
  'genshinimpact.exe': 'Genshin Impact',
  'starrail.exe': 'Honkai: Star Rail',
  'zenlesszonezero.exe': 'Zenless Zone Zero',
  'osu!.exe': 'osu!',
  'hollow_knight.exe': 'Hollow Knight',
  'palworld-win64-shipping.exe': 'Palworld',
  'fc25.exe': 'EA SPORTS FC 25',
  'fc26.exe': 'EA SPORTS FC 26',
  'sotgame.exe': 'Sea of Thieves',
  'thefinals.exe': 'THE FINALS',
  'warframe.x64.exe': 'Warframe',
  'eft.exe': 'Escape from Tarkov',
  'escapefromtarkov.exe': 'Escape from Tarkov',
  'deadbydaylight-win64-shipping.exe': 'Dead by Daylight',
  'sons of the forest.exe': 'Sons of the Forest',
  'valheim.exe': 'Valheim',
  'satisfactory.exe': 'Satisfactory',
  'factoryganame-win64-shipping.exe': 'Satisfactory',
  'cities2.exe': 'Cities: Skylines II',
  'hoi4.exe': 'Hearts of Iron IV',
  'eu4.exe': 'Europa Universalis IV',
  'stellaris.exe': 'Stellaris',
  'civilizationvi.exe': 'Civilization VI',
  'civ7.exe': 'Civilization VII',
  'blackmythwukong.exe': 'Black Myth: Wukong',
  'monsterhunterwilds.exe': 'Monster Hunter Wilds',
  'nms.exe': "No Man's Sky",
};

export interface CustomGame {
  exe: string;
  name: string;
}

/** First matching game, custom entries first. */
export function detectGame(processes: string[], custom: CustomGame[]): string | null {
  const running = new Set(processes);
  for (const g of custom) if (running.has(g.exe.trim().toLowerCase())) return g.name.trim() || g.exe;
  for (const p of processes) if (KNOWN_GAMES[p]) return KNOWN_GAMES[p];
  return null;
}

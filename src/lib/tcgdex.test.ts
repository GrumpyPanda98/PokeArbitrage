import { describe, expect, it } from "vitest";
import {
  parseCardSearchQuery,
  scoreSearchResult,
  type CardSearchResult,
} from "./tcgdex";

type ParseCase = {
  aliasIds?: string[];
  localId: string;
  nameTokens: string[];
  query: string;
  tcgTrackingSetIds?: number[];
};

const parseCases: ParseCase[] = [
  {
    query: "msv2a 177",
    localId: "177",
    nameTokens: [],
    aliasIds: ["sv03.5", "SV2a"],
  },
  {
    query: "PRE 205/131",
    localId: "205",
    nameTokens: [],
    aliasIds: ["sv08.5", "SV8a"],
  },
  {
    query: "SV8a 205/187",
    localId: "205",
    nameTokens: [],
    aliasIds: ["SV8a", "sv08.5"],
  },
  {
    query: "sv2a 175",
    localId: "175",
    nameTokens: [],
    aliasIds: ["sv03.5", "SV2a"],
  },
  {
    query: "175 SV2a",
    localId: "175",
    nameTokens: [],
    aliasIds: ["sv03.5", "SV2a"],
  },
  {
    query: "TG15",
    localId: "TG15",
    nameTokens: [],
    aliasIds: [],
  },
  {
    query: "Blaziken TG15",
    localId: "TG15",
    nameTokens: ["BLAZIKEN"],
    aliasIds: [],
  },
  {
    query: "Blaziken SIT 15",
    localId: "15",
    nameTokens: ["BLAZIKEN"],
    aliasIds: ["swsh12"],
    tcgTrackingSetIds: [3170, 17674],
  },
  {
    query: "Blaziken VMAX Silver Tempest TG15",
    localId: "TG15",
    nameTokens: ["BLAZIKEN", "VMAX"],
    aliasIds: ["swsh12"],
  },
  {
    query: "Pikachu on the Ball Futsal 2020 1",
    localId: "1",
    nameTokens: ["PIKACHU", "ON", "THE", "BALL"],
    aliasIds: ["fut2020"],
  },
  {
    query: "Pikachu on the Ball FUT20 1",
    localId: "1",
    nameTokens: ["PIKACHU", "ON", "THE", "BALL"],
    aliasIds: ["fut2020"],
  },
  {
    query: "Blaziken EM 1",
    localId: "1",
    nameTokens: ["BLAZIKEN"],
    aliasIds: ["ex9"],
    tcgTrackingSetIds: [1410],
  },
  {
    query: "Blaziken Emerald 1",
    localId: "1",
    nameTokens: ["BLAZIKEN"],
    aliasIds: ["ex9"],
  },
  {
    query: "Umbreon VMAX EVS 215",
    localId: "215",
    nameTokens: ["UMBREON", "VMAX"],
    aliasIds: ["swsh7"],
  },
  {
    query: "Umbreon VMAX Evolving Skies 215/203",
    localId: "215",
    nameTokens: ["UMBREON", "VMAX"],
    aliasIds: ["swsh7"],
  },
  {
    query: "Charizard ex OBF 223/197",
    localId: "223",
    nameTokens: ["CHARIZARD", "EX"],
    aliasIds: ["sv03"],
  },
  {
    query: "Mewtwo VSTAR GG44",
    localId: "GG44",
    nameTokens: ["MEWTWO", "VSTAR"],
    aliasIds: [],
  },
  {
    query: "Giratina VSTAR CRZ GG69",
    localId: "GG69",
    nameTokens: ["GIRATINA", "VSTAR"],
    aliasIds: ["swsh12.5"],
  },
  {
    query: "Charizard GX HIF SV49",
    localId: "SV49",
    nameTokens: ["CHARIZARD", "GX"],
    aliasIds: ["sm115", "sma"],
  },
  {
    query: "Gengar VMAX FST 271",
    localId: "271",
    nameTokens: ["GENGAR", "VMAX"],
    aliasIds: ["swsh8"],
  },
  {
    query: "Lugia V SIT 186",
    localId: "186",
    nameTokens: ["LUGIA", "V"],
    aliasIds: ["swsh12"],
  },
  {
    query: "Magikarp PAL 203",
    localId: "203",
    nameTokens: ["MAGIKARP"],
    aliasIds: ["sv02"],
  },
  {
    query: "Rayquaza VMAX TG20",
    localId: "TG20",
    nameTokens: ["RAYQUAZA", "VMAX"],
    aliasIds: [],
  },
];

describe("TCG search parsing", () => {
  it.each(parseCases)(
    "parses common Pokemon search format: $query",
    ({ aliasIds = [], localId, nameTokens, query, tcgTrackingSetIds }) => {
      const parsed = parseCardSearchQuery(query);

      expect(parsed.localId).toBe(localId);
      expect(parsed.nameTokens).toEqual(nameTokens);
      expect(parsed.setAliases.map((alias) => alias.setId)).toEqual(aliasIds);
      if (tcgTrackingSetIds) {
        expect(parsed.tcgTrackingSetIds).toEqual(tcgTrackingSetIds);
      }
    },
  );

  it("does not mistake Pokemon names for set codes", () => {
    const parsed = parseCardSearchQuery("Blaziken TG15");

    expect(parsed.localId).toBe("TG15");
    expect(parsed.nameTokens).toEqual(["BLAZIKEN"]);
    expect(parsed.setAliases).toEqual([]);
  });

  it("does not treat years in set names as card numbers", () => {
    const parsed = parseCardSearchQuery("Pikachu on the Ball Futsal 2020 1");

    expect(parsed.localId).toBe("1");
    expect(parsed.nameTokens).toEqual(["PIKACHU", "ON", "THE", "BALL"]);
    expect(parsed.setAliases.map((alias) => alias.setId)).toEqual(["fut2020"]);
  });

  it("keeps Asian and Western aliases available for shared set names", () => {
    const parsed = parseCardSearchQuery("151 175");

    expect(parsed.setAliases.map((alias) => `${alias.language}:${alias.setId}`)).toEqual([
      "en:sv03.5",
      "ja:SV2a",
    ]);
  });
});

describe("TCG search scoring", () => {
  it.each([
    {
      query: "Blaziken SIT 15",
      expected: card("Blaziken VMAX", "Silver Tempest", "TG15/195", {
        tcgDexSetId: "swsh12",
      }),
      alternatives: [
        card("Chesnaught V", "Silver Tempest", "015/195", {
          tcgDexSetId: "swsh12",
        }),
        card("Blaziken", "Ruby & Sapphire", "15/109", {
          tcgDexSetId: "ex1",
        }),
      ],
    },
    {
      query: "Blaziken EM 1",
      expected: card("Blaziken", "Emerald", "1/106", {
        tcgDexSetId: "ex9",
      }),
      alternatives: [
        card("Blaziken", "Ruby & Sapphire", "3/109", {
          tcgDexSetId: "ex1",
        }),
        card("Electrode", "Emerald", "1/106", {
          tcgDexSetId: "ex9",
        }),
      ],
    },
    {
      query: "Umbreon VMAX EVS 215",
      expected: card("Umbreon VMAX", "Evolving Skies", "215/203", {
        tcgDexSetId: "swsh7",
      }),
      alternatives: [
        card("Umbreon VMAX", "Brilliant Stars", "TG23/172", {
          tcgDexSetId: "swsh9",
        }),
        card("Flaaffy", "Evolving Skies", "215/203", {
          tcgDexSetId: "swsh7",
        }),
      ],
    },
    {
      query: "Charizard ex OBF 223/197",
      expected: card("Charizard ex", "Obsidian Flames", "223/197", {
        tcgDexSetId: "sv03",
      }),
      alternatives: [
        card("Charizard ex", "Pokemon 151", "199/165", {
          tcgDexSetId: "sv03.5",
        }),
        card("Pidgeot ex", "Obsidian Flames", "225/197", {
          tcgDexSetId: "sv03",
        }),
      ],
    },
    {
      query: "Mewtwo VSTAR GG44",
      expected: card("Mewtwo VSTAR", "Crown Zenith", "GG44/159", {
        tcgDexSetId: "swsh12.5",
      }),
      alternatives: [
        card("Ditto", "Crown Zenith", "044/159", {
          tcgDexSetId: "swsh12.5",
        }),
        card("Mewtwo", "Pokemon GO", "044/078", {
          tcgDexSetId: "pgo",
        }),
      ],
    },
    {
      query: "Pikachu on the Ball FUT20 1",
      expected: card("Pikachu on the Ball", "Pokemon Futsal 2020", "1/5", {
        tcgDexSetId: "fut2020",
      }),
      alternatives: [
        card("Pikachu", "Wizards Black Star Promos", "1/53", {
          tcgDexSetId: "basep",
        }),
        card("Koffing", "Base Set", "001/102", {
          tcgDexSetId: "base1",
        }),
      ],
    },
    {
      query: "sv2a 175",
      expected: card("コダック", "ポケモンカード151", "175/210", {
        tcgDexSetId: "SV2a",
        language: "ja",
      }),
      alternatives: [
        card("Psyduck", "Pokemon 151", "175/207", {
          tcgDexSetId: "sv03.5",
        }),
        card("Tangela", "Pokemon 151", "178/207", {
          tcgDexSetId: "sv03.5",
        }),
      ],
    },
    {
      query: "msv2a 177",
      expected: card("ゴーリキー", "ポケモンカード151", "177/210", {
        tcgDexSetId: "SV2a",
        language: "ja",
      }),
      alternatives: [
        card("Machoke", "Pokemon 151", "177/207", {
          tcgDexSetId: "sv03.5",
        }),
        card("Potion", "Sword & Shield", "177/202", {
          tcgDexSetId: "swsh1",
        }),
      ],
    },
    {
      query: "TG15",
      expected: card("Blaziken VMAX", "Silver Tempest", "TG15/195", {
        tcgDexSetId: "swsh12",
      }),
      alternatives: [
        card("Sylveon VMAX", "Brilliant Stars", "TG15/172", {
          tcgDexSetId: "swsh9",
        }),
        card("Centiskorch VMAX", "Lost Origin", "TG15/196", {
          tcgDexSetId: "swsh11",
        }),
      ],
    },
  ])("$query ranks the expected card first", ({ alternatives, expected, query }) => {
    const parsed = parseCardSearchQuery(query);
    const scored = [expected, ...alternatives].sort(
      (a, b) => scoreSearchResult(b, parsed) - scoreSearchResult(a, parsed),
    );

    expect(scored[0]).toBe(expected);
  });

  it("boosts Japanese-style cards for the Asian bucket", () => {
    const parsed = parseCardSearchQuery("151 175");
    const japanese = card("コダック", "ポケモンカード151", "175/210", {
      language: "ja",
      tcgDexSetId: "SV2a",
    });
    const english = card("Psyduck", "Pokemon 151", "175/207", {
      language: "en",
      tcgDexSetId: "sv03.5",
    });

    expect(scoreSearchResult(japanese, parsed, {
      languageBucket: "asian",
      preferredLanguage: "ja",
    })).toBeGreaterThan(scoreSearchResult(english, parsed, {
      languageBucket: "asian",
      preferredLanguage: "ja",
    }));
  });

  it("boosts Western cards for the Western bucket", () => {
    const parsed = parseCardSearchQuery("151 175");
    const japanese = card("コダック", "ポケモンカード151", "175/210", {
      language: "ja",
      tcgDexSetId: "SV2a",
    });
    const english = card("Psyduck", "Pokemon 151", "175/207", {
      language: "en",
      tcgDexSetId: "sv03.5",
    });

    expect(scoreSearchResult(english, parsed, {
      languageBucket: "western",
      preferredLanguage: "en",
    })).toBeGreaterThan(scoreSearchResult(japanese, parsed, {
      languageBucket: "western",
      preferredLanguage: "en",
    }));
  });
});

function card(
  name: string,
  setName: string,
  cardNumber: string,
  overrides: Partial<CardSearchResult> = {},
): CardSearchResult {
  return {
    id: overrides.id ?? `${setName}-${cardNumber}`,
    name,
    setName,
    cardNumber,
    imageUrl: "",
    language: "en",
    source: "tcgdex",
    ...overrides,
  };
}

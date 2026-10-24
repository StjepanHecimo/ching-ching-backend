const test = require("node:test");
const assert = require("node:assert/strict");
const {
  VenueChinChinPanelService,
} = require("../src/venue-chin-chin-panel/venue-chin-chin-panel.service");
const {
  ReservationsService,
} = require("../src/reservations/reservations.service");

function fixture() {
  const events = [];
  const writes = [];
  const venue = Object.freeze({
    id: "venue-1",
    name: "Club",
    country: "HR",
    venueType: "CLUB",
    isLive: true,
    liveChinChinTableIds: Object.freeze(["standard-1", "large-1", "vip-1"]),
  });
  const prisma = {
    venue: {
      findUnique: async () => venue,
      update: () => assert.fail("menu save must not change live selection"),
    },
    reservation: {
      updateMany: () => assert.fail("menu save must not lock reservations"),
    },
    venueChinChinPanel: {
      findUnique: async () => null,
      upsert: async (input) => {
        writes.push(input);
        return { venueId: venue.id, venue, ...input.update };
      },
    },
  };
  const service = new VenueChinChinPanelService(
    prisma,
    {},
    {},
    {
      emit: (venueId, reason) => events.push({ venueId, reason }),
    },
  );
  service.ensureDefaultDrinkBrands = async () => {};
  service.ensureDefaultContentAssets = async () => {};
  service.normalizeDrinks = async (input) => input;
  service.scheduleNotificationsForAddedEvents = async () => {};
  service.serializePanel = (panel) => panel;
  return { service, prisma, venue, events, writes };
}

for (const change of [
  {
    name: "Jack Daniel's",
    promoPriceLabel: "100",
    tableConditionTiers: ["STANDARD", "LARGE", "VIP"],
  },
  {
    name: "Jack Daniel's",
    promoPriceLabel: "100",
    tableConditionTiers: ["LARGE", "VIP"],
  },
  {
    name: "Jack Daniel's",
    promoPriceLabel: "120",
    tableConditionTiers: ["STANDARD"],
  },
  { name: "Jameson", promoPriceLabel: "90", tableConditionTiers: ["VIP"] },
  { name: "Jack Daniel's", tableConditionTiers: [] },
]) {
  test(`saving live menu refreshes clients without locking tables: ${JSON.stringify(change)}`, async () => {
    const { service, events, venue, writes } = fixture();
    await service.upsertForVenue(venue.id, {
      promotionalDrinks: [change],
      hasDraftBeer: false,
      hasEvent: false,
    });
    assert.deepEqual(events, [
      { venueId: venue.id, reason: "chin_chin_panel_updated" },
    ]);
    assert.equal(venue.isLive, true);
    assert.deepEqual(venue.liveChinChinTableIds, [
      "standard-1",
      "large-1",
      "vip-1",
    ]);
    assert.equal(writes[0].update.promotionalDrinks[0].name, change.name);
    assert.equal(writes[0].update.isLive, undefined);
    assert.equal(writes[0].update.liveChinChinTableIds, undefined);
  });
}

test("failed panel save does not emit a misleading update", async () => {
  const { service, prisma, events } = fixture();
  prisma.venueChinChinPanel.upsert = async () => {
    throw new Error("save failed");
  };
  await assert.rejects(
    service.upsertForVenue("venue-1", {
      promotionalDrinks: [{ name: "Jameson" }],
      hasDraftBeer: false,
      hasEvent: false,
    }),
  );
  assert.deepEqual(events, []);
});

test("menu notification does not query or replace table occupancy", async () => {
  const service = Object.create(ReservationsService.prototype);
  const messages = [];
  service.venueLiveSyncSubject = () => ({
    next: (event) => messages.push(event),
  });
  service.listVenueReservedTableIds = () =>
    assert.fail("must not fetch locks for a menu edit");
  service.getVenueLiveStatus = () =>
    assert.fail("must not rebuild live state for a menu edit");
  await service.emitVenueLiveSync("venue-1", "chin_chin_panel_updated");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.reason, "chin_chin_panel_updated");
  assert.equal(messages[0].data.reservedTables, undefined);
  assert.equal(messages[0].data.liveStatus, undefined);
});

test("removing VIP drink or changing its price leaves standard availability unchanged at four guests", async () => {
  const { service: panelService, venue } = fixture();
  const availability = Object.create(ReservationsService.prototype);
  const now = new Date();
  const end = new Date(now.getTime() + 90 * 60 * 1000);
  availability.getVenueReservationState = async () => venue;
  availability.parseSlot = () => ({
    startAt: now,
    endAt: end,
    checkInOpensAt: now,
    checkInClosesAt: end,
    arrivalDeadlineAt: end,
  });
  availability.resolveReservationType = () => "LIVE";
  availability.assertAdvanceReservationHorizon = () => {};
  availability.validateReservationRuleContext = () => 0;
  availability.effectiveConfiguredLivePricingPackage = () => "DEFAULT";
  availability.getEffectiveLivePricingBoostForSlot = async () => "DEFAULT";
  availability.releaseExpiredReservationLocks = async () => {};
  const tables = [
    {
      tableId: "standard-1",
      chinChinTier: "STANDARD",
      minPartySize: 2,
      maxPartySize: 4,
    },
    {
      tableId: "standard-2",
      chinChinTier: "STANDARD",
      minPartySize: 2,
      maxPartySize: 4,
    },
    {
      tableId: "large-1",
      chinChinTier: "LARGE",
      minPartySize: 4,
      maxPartySize: 6,
    },
    {
      tableId: "vip-1",
      chinChinTier: "VIP",
      minPartySize: 6,
      maxPartySize: 12,
    },
  ].map((table) => ({
    ...table,
    tableLabel: table.tableId,
    roomLabel: "Room A",
    reservable: true,
    isVipLike: table.chinChinTier === "VIP",
  }));
  availability.getApprovedChinChinTables = async () => tables;
  // Keep one genuinely reserved standard table as a control.
  availability.findBlockingReservations = async () => [
    {
      tableId: "standard-2",
      tableLabel: "standard-2",
      roomLabel: "Room A",
    },
  ];
  availability.getVenueReservationState = async () => ({
    ...venue,
    liveChinChinTableIds: tables.map((table) => table.tableId),
  });
  const query = {
    type: "LIVE",
    startAt: now.toISOString(),
    endAt: end.toISOString(),
    partySize: 4,
  };
  const before = await availability.getVenueAvailability(venue.id, query);
  assert.equal(
    before.tables.find((table) => table.tableId === "standard-1").available,
    true,
  );
  assert.equal(
    before.tables.find((table) => table.tableId === "standard-2")
      .unavailableReason,
    "RESERVED",
  );

  for (const drink of [
    {
      name: "Jack Daniel's",
      promoPriceLabel: "100",
      tableConditionTiers: ["STANDARD", "LARGE", "VIP"],
    },
    {
      name: "Jack Daniel's",
      promoPriceLabel: "100",
      tableConditionTiers: ["STANDARD", "LARGE"],
    },
    {
      name: "Jack Daniel's",
      promoPriceLabel: "120",
      tableConditionTiers: ["STANDARD"],
    },
    { name: "Jameson", promoPriceLabel: "90", tableConditionTiers: [] },
  ]) {
    await panelService.upsertForVenue(venue.id, {
      promotionalDrinks: [drink],
      hasDraftBeer: false,
      hasEvent: false,
    });
    const after = await availability.getVenueAvailability(venue.id, query);
    assert.equal(after.partySize, 4);
    assert.deepEqual(after.tables, before.tables);
  }
});

for (const changed of [false, true]) {
  test(`existing event triggers availability refresh only if the event changes: ${changed}`, async () => {
    const { service, prisma, events } = fixture();
    const previousEvent = {
      id: "event-1",
      day: "2026-10-24",
      startsAt: "20:00",
      endsAt: "23:00",
      band: "Band",
      content: { name: "Band", contentKey: "band" },
    };
    prisma.venueChinChinPanel.findUnique = async () => ({
      hasEvent: true,
      events: [previousEvent],
    });
    service.extractStoredEventsForNotification = () => [previousEvent];
    service.collectEventInputs = () => [previousEvent];
    service.normalizePanelEvents = async () => [
      changed
        ? { ...previousEvent, startsAt: "21:00" }
        : Object.fromEntries(Object.entries(previousEvent).reverse()),
    ];
    await service.upsertForVenue("venue-1", {
      promotionalDrinks: [
        { name: "Jack Daniel's", tableConditionTiers: ["STANDARD"] },
      ],
      hasDraftBeer: false,
      hasEvent: true,
    });
    assert.deepEqual(
      events.map((event) => event.reason),
      changed
        ? ["chin_chin_panel_updated", "chin_chin_panel_events_updated"]
        : ["chin_chin_panel_updated"],
    );
  });
}

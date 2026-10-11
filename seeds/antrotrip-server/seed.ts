/**
 * mogo test fixtures for antrotrip-server.
 *
 * Copied into the checked-out repo root and run with that repo's own Prisma client, after
 * `prisma migrate deploy`, `pnpm bootstrap` and `pnpm seed` (see `prepare` in the repo settings):
 *
 *   cp "$MOGO_SEEDS_DIR/antrotrip-server/seed.ts" ./mogo-seed.ts && pnpm exec tsx ./mogo-seed.ts
 *
 * Idempotent: every record is looked up first, so it is safe to run twice.
 * Throwaway data only. Never run against a real database.
 */
import {
  AccommodationCategory,
  ActivityType,
  AuthProvider,
  BillingPlanKey,
  BusinessMemberRole,
  BusinessTaxType,
  BusinessVerificationStatus,
  ClaimDocumentType,
  ClaimStatus,
  FlexibilityStatus,
  Gender,
  ListingCategory,
  ListingSource,
  ListingStatus,
  LodgingRoomType,
  MealType,
  PriceLevel,
  TripMemberStatus,
  TripMemberType,
} from "@prisma/client";

import { prisma } from "./src/config/db";
import { redisConnection } from "./src/db/redis";

const OTP_CODE = "111111"; // verify-otp requires exactly 6 characters
const OTP_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_EMAIL = "alice.johnson@admin.com"; // created by `pnpm seed`, password 12345678

const email = (local: string) => `${local}@seed.antrotrip.test`;
const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000);

// ---------------------------------------------------------------------------------------------
// Users (app users are passwordless: log in with the OTP armed in Valkey below)
// ---------------------------------------------------------------------------------------------

interface SeedUser {
  local: string;
  first?: string;
  last?: string;
  provider: AuthProvider;
  withProfile: boolean;
  isDisabled?: boolean;
  note: string;
}

const USERS: SeedUser[] = [
  {
    local: "traveler",
    first: "Tara",
    last: "Traveler",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: true,
    note: "traveler, owns the sample trips",
  },
  {
    local: "friend",
    first: "Farhan",
    last: "Friend",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: true,
    note: "confirmed member of the sample trip",
  },
  {
    local: "owner.verified",
    first: "Vera",
    last: "Verified",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: true,
    note: "owner of the VERIFIED business",
  },
  {
    local: "owner.pending",
    first: "Pavel",
    last: "Pending",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: true,
    note: "owner of the PENDING business",
  },
  {
    local: "owner.rejected",
    first: "Rana",
    last: "Rejected",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: true,
    note: "owner of the REJECTED business",
  },
  {
    local: "owner.unverified",
    first: "Uma",
    last: "Unverified",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: true,
    note: "owner of the UNVERIFIED business",
  },
  {
    local: "coastal.owner",
    first: "Olin",
    last: "Coastal",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: true,
    note: "OWNER of the multi-member business",
  },
  {
    local: "coastal.manager",
    first: "Mina",
    last: "Coastal",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: true,
    note: "MANAGER of the multi-member business",
  },
  {
    local: "coastal.staff",
    first: "Sami",
    last: "Coastal",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: true,
    note: "STAFF of the multi-member business",
  },
  {
    local: "google.user",
    first: "Gina",
    last: "Google",
    provider: AuthProvider.GOOGLE,
    withProfile: true,
    note: "Google-provider user",
  },
  {
    local: "new.user",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: false,
    note: "no profile yet: verify-otp returns profileRequired + tempToken",
  },
  {
    local: "guest",
    provider: AuthProvider.GUEST,
    withProfile: false,
    note: "guest account (e.g. from a guest listing submission)",
  },
  {
    local: "disabled",
    first: "Dani",
    last: "Disabled",
    provider: AuthProvider.PASSWORDLESS,
    withProfile: true,
    isDisabled: true,
    note: "disabled: verify-otp is refused with 403",
  },
];

const upsertUser = (u: SeedUser) =>
  prisma.user.upsert({
    where: { email: email(u.local) },
    update: {},
    create: {
      email: email(u.local),
      name: u.first ? `${u.first} ${u.last}` : null,
      authProvider: u.provider,
      isDisabled: u.isDisabled ?? false,
      googleId:
        u.provider === AuthProvider.GOOGLE ? `seed-google-${u.local}` : null,
      profile: u.withProfile
        ? {
            create: {
              firstName: u.first!,
              lastName: u.last!,
              gender: Gender.OTHER,
              dateOfBirth: new Date("1992-05-14"),
            },
          }
        : undefined,
    },
  });

/** verify-otp deletes the code once used, so re-arm with:
 *  valkey-cli set otp:email:<address> 111111 EX 3600 */
const armOtps = () =>
  Promise.all(
    USERS.map((u) =>
      redisConnection.set(
        `otp:email:${email(u.local)}`,
        OTP_CODE,
        "EX",
        OTP_TTL_SECONDS,
      ),
    ),
  );

// ---------------------------------------------------------------------------------------------
// Businesses: one per verification state, plus a multi-member one
// ---------------------------------------------------------------------------------------------

interface SeedBusiness {
  name: string;
  status: BusinessVerificationStatus;
  tier: BillingPlanKey;
  owner: string;
  members?: { local: string; role: BusinessMemberRole }[];
  rejectionReason?: string;
  tradeLicenseNo?: string;
  tinBin?: string;
}

const BUSINESSES: SeedBusiness[] = [
  {
    name: "Sea Breeze Resort Ltd",
    status: BusinessVerificationStatus.VERIFIED,
    tier: BillingPlanKey.PREMIUM,
    owner: "owner.verified",
    tradeLicenseNo: "TL-SEED-1001",
    tinBin: "TIN-SEED-1001",
  },
  {
    name: "Hill View Hotel",
    status: BusinessVerificationStatus.PENDING,
    tier: BillingPlanKey.FREE,
    owner: "owner.pending",
    tradeLicenseNo: "TL-SEED-2002",
  },
  {
    name: "Old Town Eatery",
    status: BusinessVerificationStatus.REJECTED,
    tier: BillingPlanKey.FREE,
    owner: "owner.rejected",
    tradeLicenseNo: "TL-SEED-3003",
    rejectionReason:
      "The trade license image is unreadable. Please upload a clear copy.",
  },
  {
    name: "Fresh Start Cafe",
    status: BusinessVerificationStatus.UNVERIFIED,
    tier: BillingPlanKey.FREE,
    owner: "owner.unverified",
  },
  {
    name: "Coastal Hospitality Group",
    status: BusinessVerificationStatus.VERIFIED,
    tier: BillingPlanKey.HYBRID_PREMIUM,
    owner: "coastal.owner",
    tradeLicenseNo: "TL-SEED-5005",
    tinBin: "BIN-SEED-5005",
    members: [
      { local: "coastal.manager", role: BusinessMemberRole.MANAGER },
      { local: "coastal.staff", role: BusinessMemberRole.STAFF },
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Listings: every claim / review state
// ---------------------------------------------------------------------------------------------

interface SeedListing {
  slug: string;
  name: string;
  category: ListingCategory;
  city: string;
  lat: number;
  lng: number;
  status: ListingStatus;
  isPublished: boolean;
  isDisabled?: boolean;
  business?: string; // business name; absent = unclaimed
  source?: ListingSource;
  createdBy?: string; // user local part
  rejectionReason?: string;
  priceLevel?: PriceLevel;
  accommodation?: {
    categories: AccommodationCategory[];
    headline: string;
    stars?: number;
  };
  restaurant?: { cuisineTypes: string[]; seatingCapacity: number };
}

const COXS = { city: "Cox's Bazar", lat: 21.4272, lng: 92.0058 };
const SYLHET = { city: "Sylhet", lat: 24.8949, lng: 91.8687 };
const DHAKA = { city: "Dhaka", lat: 23.8103, lng: 90.4125 };

const SEA_BREEZE = "Sea Breeze Resort Ltd";
const COASTAL = "Coastal Hospitality Group";
const FRESH_START = "Fresh Start Cafe";

const LISTINGS: SeedListing[] = [
  // unclaimed
  {
    slug: "seed-unclaimed-beach-hostel",
    name: "Unclaimed Beach Hostel",
    category: ListingCategory.ACCOMMODATION,
    ...COXS,
    status: ListingStatus.APPROVED,
    isPublished: true,
    source: ListingSource.ADMIN,
    priceLevel: PriceLevel.INEXPENSIVE,
    accommodation: {
      categories: [AccommodationCategory.HOSTEL],
      headline: "Budget beds steps from the sea",
    },
  },
  {
    slug: "seed-unclaimed-street-kitchen",
    name: "Unclaimed Street Kitchen",
    category: ListingCategory.RESTAURANT,
    ...DHAKA,
    status: ListingStatus.APPROVED,
    isPublished: true,
    source: ListingSource.TRAVELER,
    createdBy: "traveler",
    priceLevel: PriceLevel.INEXPENSIVE,
    restaurant: {
      cuisineTypes: ["Bangladeshi", "Street food"],
      seatingCapacity: 30,
    },
  },
  // claimed (approved claim, verified business)
  {
    slug: "seed-sea-breeze-resort",
    name: "Sea Breeze Resort",
    category: ListingCategory.ACCOMMODATION,
    ...COXS,
    status: ListingStatus.APPROVED,
    isPublished: true,
    source: ListingSource.OWNER,
    business: SEA_BREEZE,
    priceLevel: PriceLevel.EXPENSIVE,
    accommodation: {
      categories: [AccommodationCategory.RESORT],
      headline: "Beachfront resort with sea-view rooms",
      stars: 5,
    },
  },
  {
    slug: "seed-coastal-grand-hotel",
    name: "Coastal Grand Hotel",
    category: ListingCategory.ACCOMMODATION,
    ...COXS,
    status: ListingStatus.APPROVED,
    isPublished: true,
    source: ListingSource.OWNER,
    business: COASTAL,
    priceLevel: PriceLevel.MODERATE,
    accommodation: {
      categories: [AccommodationCategory.HOTEL],
      headline: "City-centre hotel run by a multi-member team",
      stars: 4,
    },
  },
  {
    slug: "seed-coastal-seafood-house",
    name: "Coastal Seafood House",
    category: ListingCategory.RESTAURANT,
    ...COXS,
    status: ListingStatus.APPROVED,
    isPublished: true,
    source: ListingSource.OWNER,
    business: COASTAL,
    priceLevel: PriceLevel.MODERATE,
    restaurant: {
      cuisineTypes: ["Seafood", "Bangladeshi"],
      seatingCapacity: 80,
    },
  },
  // claim pending / rejected / rejected-then-resubmitted (listing stays unclaimed until approved)
  {
    slug: "seed-hill-view-hotel",
    name: "Hill View Hotel",
    category: ListingCategory.ACCOMMODATION,
    ...SYLHET,
    status: ListingStatus.APPROVED,
    isPublished: true,
    source: ListingSource.ADMIN,
    accommodation: {
      categories: [AccommodationCategory.HOTEL],
      headline: "Quiet hotel above the tea gardens",
      stars: 3,
    },
  },
  {
    slug: "seed-old-town-eatery",
    name: "Old Town Eatery",
    category: ListingCategory.RESTAURANT,
    ...DHAKA,
    status: ListingStatus.APPROVED,
    isPublished: true,
    source: ListingSource.ADMIN,
    restaurant: { cuisineTypes: ["Mughlai"], seatingCapacity: 45 },
  },
  {
    slug: "seed-lakeside-guest-house",
    name: "Lakeside Guest House",
    category: ListingCategory.ACCOMMODATION,
    ...SYLHET,
    status: ListingStatus.APPROVED,
    isPublished: true,
    source: ListingSource.ADMIN,
    accommodation: {
      categories: [AccommodationCategory.VACATION_RENTAL_HOUSE],
      headline: "Lakeside house for groups",
    },
  },
  // owner lifecycle: every review state, all owned by the verified business
  {
    slug: "seed-sea-breeze-annex-draft",
    name: "Sea Breeze Annex (draft)",
    category: ListingCategory.ACCOMMODATION,
    ...COXS,
    status: ListingStatus.DRAFT,
    isPublished: false,
    source: ListingSource.OWNER,
    business: SEA_BREEZE,
    accommodation: {
      categories: [AccommodationCategory.VILLA],
      headline: "Draft listing, not submitted yet",
    },
  },
  {
    slug: "seed-sea-breeze-villa-pending-review",
    name: "Sea Breeze Villa (pending review)",
    category: ListingCategory.ACCOMMODATION,
    ...COXS,
    status: ListingStatus.PENDING_REVIEW,
    isPublished: false,
    source: ListingSource.OWNER,
    business: SEA_BREEZE,
    accommodation: {
      categories: [AccommodationCategory.VILLA],
      headline: "Waiting for admin approval",
    },
  },
  {
    slug: "seed-sea-breeze-cottage-rejected",
    name: "Sea Breeze Cottage (rejected)",
    category: ListingCategory.ACCOMMODATION,
    ...COXS,
    status: ListingStatus.REJECTED,
    isPublished: false,
    source: ListingSource.OWNER,
    business: SEA_BREEZE,
    rejectionReason:
      "Photos do not show the property. Please upload real photos.",
    accommodation: {
      categories: [AccommodationCategory.VACATION_RENTAL_HOUSE],
      headline: "Rejected by an admin",
    },
  },
  {
    slug: "seed-sea-breeze-motel-suspended",
    name: "Sea Breeze Motel (suspended)",
    category: ListingCategory.ACCOMMODATION,
    ...COXS,
    status: ListingStatus.SUSPENDED,
    isPublished: false,
    source: ListingSource.OWNER,
    business: SEA_BREEZE,
    accommodation: {
      categories: [AccommodationCategory.MOTEL],
      headline: "Suspended after a complaint",
    },
  },
  {
    slug: "seed-sea-breeze-camp-unpublished",
    name: "Sea Breeze Camp (approved, unpublished)",
    category: ListingCategory.ACCOMMODATION,
    ...COXS,
    status: ListingStatus.APPROVED,
    isPublished: false,
    source: ListingSource.OWNER,
    business: SEA_BREEZE,
    accommodation: {
      categories: [AccommodationCategory.CAMPGROUND],
      headline: "Approved but the owner has not published it",
    },
  },
  {
    slug: "seed-sea-breeze-hostel-disabled",
    name: "Sea Breeze Hostel (disabled)",
    category: ListingCategory.ACCOMMODATION,
    ...COXS,
    status: ListingStatus.APPROVED,
    isPublished: true,
    isDisabled: true,
    source: ListingSource.OWNER,
    business: SEA_BREEZE,
    accommodation: {
      categories: [AccommodationCategory.HOSTEL],
      headline: "Published but disabled by an admin",
    },
  },
  // unverified business with a draft
  {
    slug: "seed-fresh-start-cafe",
    name: "Fresh Start Cafe",
    category: ListingCategory.RESTAURANT,
    ...DHAKA,
    status: ListingStatus.DRAFT,
    isPublished: false,
    source: ListingSource.OWNER,
    business: FRESH_START,
    restaurant: { cuisineTypes: ["Cafe", "Bakery"], seatingCapacity: 20 },
  },
];

// ---------------------------------------------------------------------------------------------
// Claims: PENDING, APPROVED, REJECTED, and a resubmission after rejection
// ---------------------------------------------------------------------------------------------

interface SeedClaim {
  listing: string; // slug
  business: string; // name
  by: string; // user local part
  status: ClaimStatus;
  reason?: string;
  isResubmission?: boolean;
}

const CLAIMS: SeedClaim[] = [
  {
    listing: "seed-sea-breeze-resort",
    business: SEA_BREEZE,
    by: "owner.verified",
    status: ClaimStatus.APPROVED,
  },
  {
    listing: "seed-coastal-grand-hotel",
    business: COASTAL,
    by: "coastal.owner",
    status: ClaimStatus.APPROVED,
  },
  {
    listing: "seed-coastal-seafood-house",
    business: COASTAL,
    by: "coastal.owner",
    status: ClaimStatus.APPROVED,
  },
  {
    listing: "seed-hill-view-hotel",
    business: "Hill View Hotel",
    by: "owner.pending",
    status: ClaimStatus.PENDING,
  },
  {
    listing: "seed-old-town-eatery",
    business: "Old Town Eatery",
    by: "owner.rejected",
    status: ClaimStatus.REJECTED,
    reason: "Ownership documents do not match the listing.",
  },
  {
    listing: "seed-lakeside-guest-house",
    business: FRESH_START,
    by: "owner.unverified",
    status: ClaimStatus.REJECTED,
    reason: "Please verify your business first.",
  },
  {
    listing: "seed-lakeside-guest-house",
    business: FRESH_START,
    by: "owner.unverified",
    status: ClaimStatus.PENDING,
    isResubmission: true,
  },
];

// ---------------------------------------------------------------------------------------------

const main = async () => {
  const admin = await prisma.adminUser.findUnique({
    where: { email: ADMIN_EMAIL },
  });
  const adminId = admin?.id ?? null;

  const users: Record<string, { id: string }> = {};
  for (const u of USERS) users[u.local] = await upsertUser(u);

  const businesses: Record<string, { id: string }> = {};
  for (const b of BUSINESSES) {
    const existing = await prisma.business.findFirst({
      where: { name: b.name },
    });
    if (existing) {
      businesses[b.name] = existing;
      continue;
    }
    const verified = b.status === BusinessVerificationStatus.VERIFIED;
    businesses[b.name] = await prisma.business.create({
      data: {
        name: b.name,
        tradeLicenseNo: b.tradeLicenseNo ?? null,
        taxType: b.tinBin
          ? b.tinBin.startsWith("BIN")
            ? BusinessTaxType.BIN
            : BusinessTaxType.TIN
          : null,
        tinBin: b.tinBin ?? null,
        contactPhone: "+8801700000000",
        contactDesignation: "Owner",
        verificationStatus: b.status,
        tier: b.tier,
        rejectionReason: b.rejectionReason ?? null,
        verifiedByAdminId: verified ? adminId : null,
        verifiedAt: verified ? new Date() : null,
        members: {
          create: [
            { userId: users[b.owner].id, role: BusinessMemberRole.OWNER },
            ...(b.members ?? []).map((m) => ({
              userId: users[m.local].id,
              role: m.role,
            })),
          ],
        },
      },
    });
  }

  const listings: Record<string, { id: string }> = {};
  for (const l of LISTINGS) {
    const existing = await prisma.listing.findUnique({
      where: { slug: l.slug },
    });
    if (existing) {
      listings[l.slug] = existing;
      continue;
    }
    const decided = (
      [
        ListingStatus.APPROVED,
        ListingStatus.REJECTED,
        ListingStatus.SUSPENDED,
      ] as ListingStatus[]
    ).includes(l.status);
    const now = new Date();
    listings[l.slug] = await prisma.listing.create({
      data: {
        slug: l.slug,
        name: l.name,
        category: l.category,
        source: l.source ?? ListingSource.ADMIN,
        businessId: l.business ? businesses[l.business].id : null,
        createdByUserId: l.createdBy ? users[l.createdBy].id : null,
        description: `${l.name}. Seed data for mogo tests.`,
        mapAddress: `${l.name}, ${l.city}, Bangladesh`,
        textAddress: `1 Seed Road, ${l.city}`,
        city: l.city,
        country: "Bangladesh",
        latitude: l.lat,
        longitude: l.lng,
        priceLevel: l.priceLevel ?? PriceLevel.MODERATE,
        status: l.status,
        isPublished: l.isPublished,
        isDisabled: l.isDisabled ?? false,
        submittedAt: l.status === ListingStatus.DRAFT ? null : now,
        reviewedAt: decided ? now : null,
        reviewedByAdminId: decided ? adminId : null,
        rejectionReason: l.rejectionReason ?? null,
        accommodation: l.accommodation
          ? {
              create: {
                class: l.accommodation.stars ?? null,
                headline: l.accommodation.headline,
                categories: {
                  create: l.accommodation.categories.map((category) => ({
                    category,
                  })),
                },
              },
            }
          : undefined,
        restaurant: l.restaurant
          ? {
              create: {
                cuisineTypes: l.restaurant.cuisineTypes,
                seatingCapacity: l.restaurant.seatingCapacity,
              },
            }
          : undefined,
      },
    });
  }

  const seafoodId = listings["seed-coastal-seafood-house"].id;
  if (
    (await prisma.restaurantMenuCategory.count({
      where: { listingId: seafoodId },
    })) === 0
  ) {
    const mains = await prisma.restaurantMenuCategory.create({
      data: { listingId: seafoodId, name: "Mains", sortOrder: 1 },
    });
    await prisma.restaurantMenuItem.createMany({
      data: [
        {
          listingId: seafoodId,
          categoryId: mains.id,
          name: "Grilled Lobster",
          price: 2400,
          description: "Fresh catch, garlic butter",
          sortOrder: 1,
        },
        {
          listingId: seafoodId,
          categoryId: mains.id,
          name: "Fish Curry with Rice",
          price: 650,
          description: "Coastal-style curry",
          sortOrder: 2,
        },
      ],
    });
  }

  for (const c of CLAIMS) {
    const listingId = listings[c.listing].id;
    const businessId = businesses[c.business].id;
    const exists = await prisma.listingClaim.findFirst({
      where: { listingId, businessId, status: c.status },
    });
    if (exists) continue;
    const decided = c.status !== ClaimStatus.PENDING;
    await prisma.listingClaim.create({
      data: {
        listingId,
        businessId,
        submittedByUserId: users[c.by].id,
        status: c.status,
        rejectionReason:
          c.status === ClaimStatus.REJECTED ? (c.reason ?? null) : null,
        isResubmission: c.isResubmission ?? false,
        reviewedByAdminId: decided ? adminId : null,
        reviewedAt: decided ? new Date() : null,
        documents: {
          create: [
            {
              type: ClaimDocumentType.TRADE_LICENSE,
              path: "seed/claims/trade-license.pdf",
            },
          ],
        },
      },
    });
  }

  // ---- trips -------------------------------------------------------------------------------
  const TRIP_TITLE = "Cox's Bazar Weekend (seed)";
  const creatorId = users["traveler"].id;
  if (
    !(await prisma.trip.findFirst({ where: { creatorId, title: TRIP_TITLE } }))
  ) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const from = addDays(start, 30);
    const to = addDays(from, 2);

    const trip = await prisma.trip.create({
      data: {
        title: TRIP_TITLE,
        description:
          "Three days by the sea with friends. Seed data for mogo tests.",
        creatorId,
        numberOfMembers: 3,
        memberType: TripMemberType.FRIENDS,
        isFlexibleTrip: false,
        tripFrom: from,
        tripEnd: to,
        tripDays: 3,
        isTransportationIncluded: false,
        isPrivate: false,
        startLocation: "Dhaka",
        startLocationLat: DHAKA.lat,
        startLocationLng: DHAKA.lng,
        places: {
          create: [
            {
              label: "Dhaka",
              latitude: DHAKA.lat,
              longitude: DHAKA.lng,
              order: 0,
              country: "Bangladesh",
            },
            {
              label: "Cox's Bazar",
              latitude: COXS.lat,
              longitude: COXS.lng,
              order: 1,
              country: "Bangladesh",
            },
          ],
        },
        members: {
          create: [
            {
              userId: creatorId,
              displayName: "Tara Traveler",
              color: "#E53935",
              status: TripMemberStatus.CONFIRMED,
            },
            {
              userId: users["friend"].id,
              displayName: "Farhan Friend",
              color: "#1E88E5",
              status: TripMemberStatus.CONFIRMED,
              respondedAt: new Date(),
            },
            {
              invitationEmail: email("invitee"),
              displayName: "Invited Guest",
              color: "#43A047",
              status: TripMemberStatus.PENDING,
              invitationToken: "seed-invitation-token",
              invitedAt: new Date(),
            },
          ],
        },
      },
      include: { members: true },
    });

    await prisma.tripLodging.create({
      data: {
        tripId: trip.id,
        host: "Sea Breeze Resort",
        address: "1 Seed Road, Cox's Bazar",
        latitude: COXS.lat,
        longitude: COXS.lng,
        flexibilityStatus: FlexibilityStatus.FIXED_DATE,
        checkInDayNumber: 1,
        checkOutDayNumber: 3,
        checkInDate: from,
        checkOutDate: to,
        numberOfRooms: 1,
        totalPrice: 18000,
        listingId: listings["seed-sea-breeze-resort"].id,
        members: { create: trip.members.map((m) => ({ tripMemberId: m.id })) },
        rooms: {
          create: [
            { roomNumber: "101", roomType: LodgingRoomType.AC, price: 6000 },
          ],
        },
      },
    });
    await prisma.tripMeal.create({
      data: {
        tripId: trip.id,
        mealType: MealType.DINNER,
        address: "Coastal Seafood House, Cox's Bazar",
        latitude: COXS.lat,
        longitude: COXS.lng,
        time: "20:00",
        flexibilityStatus: FlexibilityStatus.FIXED_DATE,
        dayNumber: 1,
        date: from,
        totalCost: 3000,
        listingId: seafoodId,
      },
    });
    await prisma.tripActivity.create({
      data: {
        tripId: trip.id,
        type: ActivityType.SUNSET,
        title: "Sunset at Laboni Beach",
        flexibilityStatus: FlexibilityStatus.FIXED_DATE,
        dayNumber: 2,
        date: addDays(from, 1),
        startTime: "17:00",
        endTime: "18:30",
        durationMinutes: 90,
      },
    });
  }

  const SOLO_TITLE = "Sylhet Tea Gardens (flexible, solo, seed)";
  if (
    !(await prisma.trip.findFirst({ where: { creatorId, title: SOLO_TITLE } }))
  ) {
    await prisma.trip.create({
      data: {
        title: SOLO_TITLE,
        creatorId,
        numberOfMembers: 1,
        memberType: TripMemberType.SOLO,
        isFlexibleTrip: true,
        tripDays: 2,
        isTransportationIncluded: false,
        members: {
          create: [
            {
              userId: creatorId,
              displayName: "Tara Traveler",
              color: "#E53935",
              status: TripMemberStatus.CONFIRMED,
            },
          ],
        },
      },
    });
  }

  await armOtps();

  console.log(
    `Seeded ${USERS.length} users, ${BUSINESSES.length} businesses, ${LISTINGS.length} listings, ${CLAIMS.length} claims, 2 trips.`,
  );
  console.log(
    `Log in as an app user: POST /api/v1/auth/email/verify-otp {"email": "<address>", "otp": "${OTP_CODE}"}`,
  );
  for (const u of USERS) console.log(`  ${email(u.local)}  ${u.note}`);
};

main()
  .then(async () => {
    await prisma.$disconnect();
    redisConnection.disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    redisConnection.disconnect();
    process.exit(1);
  });

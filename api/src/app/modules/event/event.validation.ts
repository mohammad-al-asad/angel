import { z } from "zod";
import {
  EventCategoryConstant,
  EventFeaturesConstant,
  ticketPriceConstant,
  VenueFacilityConstant,
  visibilityConstant,
} from "./event.constant";
import { validateAndGetEventUTCInterval } from "../../utils/toISODateTime";

// ----------------------------------------------------
// Field helpers: clear messages for missing vs wrong-type vs invalid values
// ----------------------------------------------------

const requiredText = (label: string) =>
  z
    .string({
      error: (iss) => (iss.input === undefined ? `${label} is required` : `${label} must be text`),
    })
    .trim()
    .min(1, `${label} is required`);

const numberField = (label: string) =>
  z.number({
    error: (iss) => (iss.input === undefined ? `${label} is required` : `${label} must be a number`),
  });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;

const isRealDate = (v: string) => {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const dateField = z
  .string({ error: (iss) => (iss.input === undefined ? "Date is required" : "Date must be text") })
  .trim()
  .refine(isRealDate, "Date must be a real date in YYYY-MM-DD format, e.g. 2026-12-31");

const timeField = (label: string) =>
  z
    .string({ error: (iss) => (iss.input === undefined ? `${label} is required` : `${label} must be text`) })
    .trim()
    .regex(TIME_RE, `${label} must look like 10:30 AM`);

// Accepts "23.78" or 23.78 (stored as a string, as before), must be a real coordinate.
const coordinate = (label: string, max: number) =>
  z
    .union([z.string(), z.number()], { error: `${label} is required` })
    .transform((value) => String(value).trim())
    .refine((value) => value !== "" && Number.isFinite(Number(value)), {
      message: `${label} must be a number`,
    })
    .refine((value) => !Number.isFinite(Number(value)) || Math.abs(Number(value)) <= max, {
      message: `${label} must be between -${max} and ${max}`,
    });

const VenueFacilityEnum = z.enum(VenueFacilityConstant, {
  message: "Invalid venue facility type",
});

const EventCategoryEnum = z.enum(EventCategoryConstant, {
  message: "Invalid event category",
});

const EventFeaturesEnum = z.enum(EventFeaturesConstant, {
  message: "Invalid event feature",
});

const TicketPriceEnum = z.enum(ticketPriceConstant, {
  message: "Invalid ticket price type",
});

const VisibilityEnum = z.enum(visibilityConstant, {
  message: "Invalid visibility type",
});

// ----------------------------------------------------
// Venue Facility
// ----------------------------------------------------

const VenueFacilitySchema = z.object({
  type: VenueFacilityEnum,
  available: z.boolean({
    message: "Availability is required",
  }),
  description: z.string({
    message: "Description is required",
  }),
});

// ----------------------------------------------------
// Social Media
// ----------------------------------------------------

const SocialMediaSchema = z.object({
  content: z.boolean().optional(),
  gallery: z.boolean().optional(),
  sharing: z.boolean().optional(),
  streaming: z.boolean().optional(),
});

// ----------------------------------------------------
// Notification
// ----------------------------------------------------

const NotificationSchema = z.object({
  livechat: z.boolean().optional(),
  push_notifications: z.boolean().optional(),
  event_countdown: z.boolean().optional(),
});



// ----------------------------------------------------
// Event Location
// ----------------------------------------------------

const EventLocationSchema = z
  .object(
    {
      lat: coordinate("Latitude", 90),
      lon: coordinate("Longitude", 180),
    },
    { error: "Event location is required" }
  )
  // The app sends "0.0" / "0.0" when the address could not be found.
  // 0,0 is in the Atlantic Ocean, so it is never a real event location.
  .refine((loc) => !(Number(loc.lat) === 0 && Number(loc.lon) === 0), {
    message: "Event location not found. Please choose a valid address.",
    path: ["lat"],
  });

// ----------------------------------------------------
// Audience Settings
// ----------------------------------------------------

const AudienceSettingsSchema = z
  .object({
    age: z.any(),

    max_capacity: numberField("Max capacity")
      .int("Max capacity must be a whole number")
      .min(1, "Max capacity must be at least 1"),

    visibility: VisibilityEnum,

    social_media: SocialMediaSchema.optional(),

    notification: NotificationSchema.optional(),

    ticket_point_value: numberField("Ticket point value")
      .min(0, "Ticket point value can't be negative")
      .optional(),

    ticket_price: TicketPriceEnum,

    price: numberField("Price").positive("Price must be greater than 0").optional(),

    event_location: EventLocationSchema,
  })
  .superRefine((data, ctx) => {
    // Paid event must have price and ticket_point_value
    if (
      data.ticket_price === "paid" &&
      typeof data.price !== "number"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "Price is required when ticket_price is 'paid'",
      });
    }

    if (
      data.ticket_price === "paid" &&
      typeof data.ticket_point_value !== "number"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ticket_point_value"],
        message: "Ticket point value is required when ticket_price is 'paid'",
      });
    }

    // Free event cannot have price or ticket_point_value
    if (
      data.ticket_price === "free" &&
      data.price !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "Price must not exist when ticket_price is 'free'",
      });
    }

    if (
      data.ticket_price === "free" &&
      data.ticket_point_value !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ticket_point_value"],
        message: "Ticket point value must not exist when ticket_price is 'free'",
      });
    }
  });

// ----------------------------------------------------
// Create Event
// ----------------------------------------------------

const createEventZodSchema = z
  .object({
    body: z.object({
      event_title: requiredText("Event title"),

      description: requiredText("Description"),

      photo: z
        .string({
          message: "Photo is required",
        })
        .optional(),

      date: dateField,

      starting_time: timeField("Starting time"),

      ending_time: timeField("Ending time"),

      venue_facilities: z
        .array(VenueFacilitySchema)
        .optional()
        .default([]),

      event_category: EventCategoryEnum,

      event_features: EventFeaturesEnum,

      audience_settings: AudienceSettingsSchema,

      emailList: z
        .array(z.string().trim().email("Every invite must be a valid email address"))
        .optional(),

      isDelete: z.boolean().default(false),
    }),
  })
  .superRefine((data, ctx) => {
    const visibility = data.body.audience_settings.visibility;
    const emails = data.body.emailList;

    try {
      if (!isRealDate(String(data.body.date)) || !TIME_RE.test(String(data.body.starting_time)) || !TIME_RE.test(String(data.body.ending_time))) {
        throw new Error("format"); // already reported by the field rules
      }
      const { endDateTime } = validateAndGetEventUTCInterval(
        data.body.date,
        data.body.starting_time,
        data.body.ending_time
      );
      if (new Date(endDateTime).getTime() < Date.now()) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "date"],
          message: "This event would already be over. Please pick a future date or time.",
        });
      }
    } catch {
      // date/time format problems are already reported by the field rules above
    }

    // Private => emailList required
    if (
      visibility === "Private" &&
      (!emails || emails.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body", "emailList"],
        message:
          "Email list is required when visibility is Private",
      });
    }

    // Public => emailList not allowed
    if (
      visibility === "Public" &&
      emails &&
      emails.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body", "emailList"],
        message:
          "Email list is not allowed when visibility is Public",
      });
    }
  });

// ----------------------------------------------------
// Update Event
// ----------------------------------------------------

const updateEventZodSchema = z.object({
  body: z.object({
    event_title: z.string().optional(),

    description: z.string().optional(),

    photo: z.string().optional(),

    date: z.string().optional(),

    starting_time: z.string().optional(),

    ending_time: z.string().optional(),

    venue_facilities: z.array(VenueFacilitySchema).optional(),

    event_category: EventCategoryEnum.optional(),

    event_features: EventFeaturesEnum.optional(),

    audience_settings: AudienceSettingsSchema.partial().optional(),

    emailList: z
      .array(z.string().email("Invalid email address"))
      .optional(),

    isDelete: z.boolean().optional(),
  }),
});

const EventValidationSchema = {
  createEventZodSchema,
  updateEventZodSchema,
};

export default EventValidationSchema;
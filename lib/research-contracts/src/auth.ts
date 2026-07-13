import { z } from "zod";

export const PrincipalKindSchema = z.enum(["human", "service", "agent"]);

const BasePrincipalShape = {
  principalId: z.string(),
  subject: z.string(),
  scopes: z.array(z.string()),
};

export const HumanPrincipalSchema = z
  .object({
    kind: z.literal("human"),
    ...BasePrincipalShape,
  })
  .strict();

export const ServicePrincipalSchema = z
  .object({
    kind: z.literal("service"),
    ...BasePrincipalShape,
  })
  .strict();

export const AgentPrincipalSchema = z
  .object({
    kind: z.literal("agent"),
    ...BasePrincipalShape,
    servicePrincipalId: z.string(),
    manifestId: z.string(),
    manifestVersion: z.string(),
  })
  .strict();

export const PrincipalSchema = z.discriminatedUnion("kind", [
  HumanPrincipalSchema,
  ServicePrincipalSchema,
  AgentPrincipalSchema,
]);

export type PrincipalKind = z.infer<typeof PrincipalKindSchema>;
export type HumanPrincipal = z.infer<typeof HumanPrincipalSchema>;
export type ServicePrincipal = z.infer<typeof ServicePrincipalSchema>;
export type AgentPrincipal = z.infer<typeof AgentPrincipalSchema>;
export type Principal = z.infer<typeof PrincipalSchema>;

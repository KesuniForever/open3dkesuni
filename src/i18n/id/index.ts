// The Indonesian dictionary, one file per part of the app so each part can be translated on its own.
import shell from "./shell";
import order from "./order";
import customer from "./customer";
import machinesCapacity from "./machines-capacity";
import financeQuality from "./finance-quality";
import chiefOps from "./chief-ops";
import demoTokenArc from "./demo-token-arc";
import lib from "./lib";
import printing from "./printing";
import customerColors from "./customer-colors";
import budgetMaterial from "./budget-material";
import slicing from "./slicing";
import live from "./live";
import landing from "./landing";
import portal from "./portal";
import upload from "./upload";
import budgetRaise from "./budget-raise";

// landing first: its few common words ("Printer", "Demo") give way to the translation the rest of the app already uses.
export const ID: Readonly<Record<string, string>> = {
  ...landing, ...lib, ...shell, ...order, ...customer, ...machinesCapacity, ...financeQuality, ...chiefOps, ...demoTokenArc,
  ...printing, ...customerColors, ...budgetMaterial, ...slicing, ...live, ...portal, ...upload, ...budgetRaise,
};

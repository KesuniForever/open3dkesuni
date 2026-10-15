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

export const ID: Readonly<Record<string, string>> = {
  ...lib, ...shell, ...order, ...customer, ...machinesCapacity, ...financeQuality, ...chiefOps, ...demoTokenArc,
  ...printing, ...customerColors, ...budgetMaterial,
};

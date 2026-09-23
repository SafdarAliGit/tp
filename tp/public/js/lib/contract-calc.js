/**
 * Weaving Contract Terry calculations. Mirrors WeavingContractTerry.validate() in
 * towel_production so users see results instantly; the server recalculates on save.
 */
import { flt } from "@tp/core/format.js";

export const LBS_PER_KG = 2.2046;

export function calcProductRow(row) {
	row.greige_quality_weight = flt(row.finish_weight) + flt(row.finish_weight) * (flt(row.greige_weight_percent) / 100);
	row.weight_kg = flt(row.greige_quality_weight) * flt(row.qty_pcs);
	row.lbs = flt(row.weight_kg) * LBS_PER_KG;
	row.amount = flt(row.qty_pcs) * flt(row.rate);
	return row;
}

export function calcYarnRow(row, productRows) {
	const match = productRows.find((p) => p.article === row.article && p.color === row.color);
	row.article_weight = match ? flt(match.lbs) : 0;
	row.yarn_qty_lbs =
		flt(row.article_weight) * (flt(row.ratio_percent) / 100) + flt(row.article_weight) * (flt(row.wastage_percent) / 100);
	row.bags = flt(row.yarn_qty_lbs) / 100;
	return row;
}

const sum = (rows, field) => rows.reduce((total, row) => total + flt(row[field]), 0);

/** Recalculate every row and total on the document (mutates and returns it). */
export function recalculate(doc) {
	const products = doc.product_detail || [];
	const yarn = doc.yarn_details || [];
	products.forEach(calcProductRow);
	yarn.forEach((row) => calcYarnRow(row, products));

	doc.total_item_qty = sum(products, "qty_pcs");
	doc.total_kg = sum(products, "weight_kg");
	doc.total_lbs = sum(products, "lbs");
	doc.total_amount = sum(products, "amount");
	doc.total_yarn_qty_lbs = sum(yarn, "yarn_qty_lbs");
	doc.total_bags = sum(yarn, "bags");
	return doc;
}

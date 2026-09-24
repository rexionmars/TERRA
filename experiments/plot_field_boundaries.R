#!/usr/bin/env Rscript
# Figures for the field-boundary experiment.
#
# Input:  experiments/data/field_boundary_*.{csv,png}, written by
#         field_boundaries.py
# Output: experiments/figures/field_boundaries_{maps,distributions}.{svg,pdf,tiff,png}
#
# WHAT THE FIGURES SHOW. Six configurations -- three FTW checkpoints, each with
# the input at its native 10 m and enlarged by two -- over one western Parana
# box and the same two Sentinel-2 scenes. There is no reference field layer for
# this landscape, so the figures show what each configuration produces and
# where its outlines fall on the imagery, not how accurate it is.
#
#   maps           a, b the two scenes; c-h the outlines of each configuration
#                  over the sowing scene, where most field edges are visible
#                  as bare soil against vegetation
#   distributions  a  the share of the area each class takes
#                  b  the distribution of field size
#
# The numbers themselves are in experiments/data/field_boundary_runs.csv; no
# figure carries them.

suppressPackageStartupMessages({
  library(ggplot2)
  library(patchwork)
  library(dplyr)
  library(readr)
  library(scales)
})

here <- function(...) file.path("experiments", ...)
dir.create(here("figures"), showWarnings = FALSE, recursive = TRUE)

PUB_FONT <- "Arial"
stopifnot(any(systemfonts::system_fonts()$family == PUB_FONT))

theme_set(
  theme_classic(base_size = 6.5, base_family = PUB_FONT) +
    theme(
      axis.line = element_line(linewidth = 0.35, colour = "black"),
      axis.ticks = element_line(linewidth = 0.35, colour = "black"),
      axis.text = element_text(size = 5.8, colour = "black"),
      legend.title = element_text(size = 6.2),
      legend.text = element_text(size = 5.8),
      legend.key.size = unit(3, "mm"),
      strip.text = element_text(size = 6.2, face = "bold"),
      strip.background = element_blank(),
      plot.title = element_text(size = 6.5, face = "bold"),
      plot.tag = element_text(size = 8, face = "bold"),
      panel.grid = element_blank()
    )
)

save_pub_r <- function(plot, filename, width_mm = 183, height_mm = 120, dpi = 600) {
  w <- width_mm / 25.4
  h <- height_mm / 25.4
  svglite::svglite(paste0(filename, ".svg"), width = w, height = h,
                   system_fonts = list(sans = PUB_FONT))
  print(plot); dev.off()
  grDevices::cairo_pdf(paste0(filename, ".pdf"), width = w, height = h,
                       family = PUB_FONT)
  print(plot); dev.off()
  ragg::agg_tiff(paste0(filename, ".tiff"), width = w, height = h,
                 units = "in", res = dpi)
  print(plot); dev.off()
  ragg::agg_png(paste0(filename, ".png"), width = w, height = h,
                units = "in", res = 200)
  print(plot); dev.off()
}

# ------------------------------------------------------------- data
runs <- read_csv(here("data", "field_boundary_runs.csv"), show_col_types = FALSE)
fields <- read_csv(here("data", "field_boundary_fields.csv"), show_col_types = FALSE)
outlines <- read_csv(here("data", "field_boundary_outlines.csv"), show_col_types = FALSE)
area <- read_csv(here("data", "field_boundary_area.csv"), show_col_types = FALSE)
grid <- read_csv(here("data", "field_boundary_grid.csv"), show_col_types = FALSE)
scenes <- read_csv(here("data", "field_boundary_scenes.csv"), show_col_types = FALSE)

CHECKPOINT_LABEL <- c(
  FTW_v1_3_Class_CCBY = "FTW v1 CC-BY",
  FTW_PRUE_EFNET_B3_CCBY = "PRUE B3 CC-BY",
  FTW_PRUE_EFNET_B7 = "PRUE B7"
)
config_label <- function(checkpoint, factor) {
  sprintf("%s, input x%d", CHECKPOINT_LABEL[checkpoint], factor)
}
runs <- runs |>
  mutate(label = config_label(checkpoint, resize_factor),
         checkpoint_label = factor(CHECKPOINT_LABEL[checkpoint], levels = CHECKPOINT_LABEL))
CONFIG_ORDER <- runs$config
fields <- fields |>
  left_join(select(runs, config, label, checkpoint_label, resize_factor), by = "config")

# Checkpoints by hue (ColorBrewer Dark2), input scale by line type.
CHECKPOINT_COLOURS <- setNames(c("#7570B3", "#D95F02", "#1B9E77"), CHECKPOINT_LABEL)
# The class colours are the overlay's own (terra/fields/actions.py), with the
# background grey that the overlay leaves transparent.
CLASS_COLOURS <- c(background = "#BDBDBD", interior = "#4DAF4A", boundary = "#E6AB02")

# ------------------------------------------------------------- maps
img_a <- png::readPNG(here("data", "field_boundary_window_a.png"))[, , 1:3]
img_b <- png::readPNG(here("data", "field_boundary_window_b.png"))[, , 1:3]

map_base <- function(img, title) {
  ggplot() +
    annotation_raster(img, xmin = grid$xmin, xmax = grid$xmax,
                      ymin = grid$ymin, ymax = grid$ymax) +
    geom_path(data = area, aes(x, y), colour = "white", linewidth = 0.3,
              linetype = "22") +
    # A 1 km bar in the south-west corner.
    annotate("segment", x = grid$xmin + 250, xend = grid$xmin + 1250,
             y = grid$ymin + 250, yend = grid$ymin + 250,
             colour = "white", linewidth = 0.8) +
    annotate("text", x = grid$xmin + 750, y = grid$ymin + 600, label = "1 km",
             colour = "white", size = 5.8 / .pt, family = PUB_FONT) +
    coord_equal(xlim = c(grid$xmin, grid$xmax), ylim = c(grid$ymin, grid$ymax),
                expand = FALSE) +
    labs(title = title) +
    theme_void(base_size = 6.5, base_family = PUB_FONT) +
    theme(plot.title = element_text(size = 6.2, face = "bold", hjust = 0,
                                    margin = margin(b = 1.5)),
          plot.tag = element_text(size = 8, face = "bold"))
}

scene_title <- function(w) {
  s <- filter(scenes, window == w)
  sprintf("Window %s: Sentinel-2, %s", w, format(as.Date(s$date), "%d %b %Y"))
}

outline_panel <- function(cfg) {
  d <- filter(outlines, config == cfg)
  map_base(img_a, runs$label[runs$config == cfg]) +
    geom_path(data = d, aes(x, y, group = interaction(field, ring)),
              colour = "#FFD92F", linewidth = 0.18)
}

maps <- wrap_plots(
  c(list(map_base(img_a, scene_title("A")), map_base(img_b, scene_title("B"))),
    lapply(CONFIG_ORDER, outline_panel)),
  ncol = 4
) + plot_annotation(tag_levels = "a")
save_pub_r(maps, here("figures", "field_boundaries_maps"), width_mm = 183, height_mm = 102)

# ------------------------------------------------------------- distributions
fractions <- runs |>
  select(label, starts_with("frac_")) |>
  tidyr::pivot_longer(starts_with("frac_"), names_to = "class", values_to = "fraction",
                      names_prefix = "frac_") |>
  mutate(label = factor(label, levels = rev(runs$label)),
         class = factor(class, levels = c("boundary", "interior", "background")))

p_frac <- ggplot(fractions, aes(fraction, label, fill = class)) +
  geom_col(width = 0.7, colour = "white", linewidth = 0.2) +
  scale_fill_manual(values = CLASS_COLOURS, breaks = c("background", "interior", "boundary"),
                    name = "Class") +
  scale_x_continuous(labels = percent, expand = c(0, 0)) +
  labs(x = "Share of the area's clear cells", y = NULL) +
  theme(legend.position = "bottom")

p_size <- ggplot(fields, aes(area_ha, colour = checkpoint_label,
                             linetype = factor(resize_factor))) +
  stat_ecdf(linewidth = 0.45, pad = FALSE) +
  scale_x_log10(labels = label_number(drop0trailing = TRUE),
                breaks = c(0.05, 0.1, 0.5, 1, 5, 10, 50, 100)) +
  scale_y_continuous(labels = percent) +
  scale_colour_manual(values = CHECKPOINT_COLOURS, name = "Checkpoint") +
  scale_linetype_manual(values = c(`1` = "22", `2` = "solid"), name = "Input scale",
                        labels = c(`1` = "x1 (10 m)", `2` = "x2 (5 m)")) +
  labs(x = "Field area (ha, log scale)", y = "Cumulative share of fields") +
  theme(legend.position = "bottom", legend.box = "vertical",
        legend.margin = margin(0, 0, 0, 0))

dists <- (p_frac | p_size) + plot_layout(widths = c(1, 1)) +
  plot_annotation(tag_levels = "a")
save_pub_r(dists, here("figures", "field_boundaries_distributions"),
           width_mm = 183, height_mm = 75)

cat("Figures written to experiments/figures\n")

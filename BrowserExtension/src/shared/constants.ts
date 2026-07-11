/**
 * Shared constants for the DIY-MOD extension
 * Single source of truth for marker definitions
 */

/**
 * Interface for marker definition
 */
export interface MarkerDefinition {
  START: string;
  END: string;
}

/**
 * Marker constants used for content modifications
 */

export const DIY_IMG_ATTR = "diy-mod-image";

export const MARKERS = {
  // Text blur effect markers
  BLUR_START: "__BLUR_START__",
  BLUR_END: "__BLUR_END__",
  
  // Content overlay effect markers
  OVERLAY_START: "__OVERLAY_START__",
  OVERLAY_END: "__OVERLAY_END__",
  
  // Content rewrite markers
  REWRITE_START: "__REWRITE_START__",
  REWRITE_END: "__REWRITE_END__",
  REWRITE_SEPARATOR: "__REWRITE_SEPARATOR__",
  
  // Image markers
  PROCESSED_IMAGE: "__PROCESSED_IMAGE__",
  OVERLAY_IMAGE: "__OVERLAY_IMAGE__",

  // Helper function to create a new marker pair
  createMarker: (name: string): MarkerDefinition => {
    const prefix = name.toUpperCase();
    return {
      START: `__${prefix}_START__`,
      END: `__${prefix}_END__`
    };
  }
};

/**
 * CSS class names for styled elements
 */
export const CSS_CLASSES = {
  BLUR: "diymod-blur",
  OVERLAY: "diymod-overlay",
  REWRITTEN: "diymod-rewritten",
  CONTENT_OVERLAY: "content-overlay",
  HIDDEN: "hidden",
  PROCESSING: "diymod-processing"
};

/**
 * CSS variable names
 */
export const CSS_VARIABLES = {
  BLUR_INTENSITY: "--diymod-blur-intensity",
  BLUR_TRANSITION: "--diymod-blur-transition",
  HOVER_ENABLED: "--diymod-hover-enabled",
  OVERLAY_BG: "--diymod-overlay-bg",
  OVERLAY_COLOR: "--diymod-overlay-color",
  ACCENT_COLOR: "--diymod-accent-color"
};
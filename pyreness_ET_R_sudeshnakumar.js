// Define study area and time range
var startDate = ee.Date.fromYMD(2020, 6, 1);
var endDate = ee.Date.fromYMD(2024, 9, 30);
var studyBounds = aoi_euskadi; // Replace with your AOI geometry

// Map settings
Map.centerObject(studyBounds, 10);
Map.setOptions('SATELLITE');

// Function to apply scaling factors to Landsat bands
function applyScaleFactors(image) {
  var opticalBands = image.select('SR_B.').multiply(0.0000275).add(-0.2);
  var thermalBands = image.select('ST_B.*').multiply(0.00341802).add(149.0);
  return image.addBands(opticalBands, null, true)
              .addBands(thermalBands, null, true);
}

// Cloud masking function
function maskL8sr(image) {
  var cloudShadowBitMask = (1 << 3);
  var cloudsBitMask = (1 << 5);
  var qa = image.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(cloudShadowBitMask).eq(0)
               .and(qa.bitwiseAnd(cloudsBitMask).eq(0));
  return image.updateMask(mask);
}

// Load and process Landsat dataset
var dataset = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .filterBounds(studyBounds)
  .filterMetadata('CLOUD_COVER', 'less_than', 10)
  .filterDate(startDate, endDate)
  .map(applyScaleFactors)
  .map(maskL8sr)
  .median()
  .clip(studyBounds);

// Visualization parameters
var visualization = {
  bands: ['SR_B4', 'SR_B3', 'SR_B2'],
  min: 0.0,
  max: 0.3
};
Map.addLayer(dataset, visualization, 'Dataset', false);

// NDVI calculation
var ndvi = dataset.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
var ndviParams = {
  min: -1,
  max: 1,
  palette: ['white', 'green']
};
Map.addLayer(ndvi, ndviParams, 'NDVI');

// Radiation Calculation
// Estimate incoming shortwave radiation using NDVI and albedo
var albedo = dataset.expression(
  '(B2 + B3 + B4) / (B2 + B3 + B4 + B5 + B6 + B7)',
  {
    'B2': dataset.select('SR_B2'),
    'B3': dataset.select('SR_B3'),
    'B4': dataset.select('SR_B4'),
    'B5': dataset.select('SR_B5'),
    'B6': dataset.select('SR_B6'),
    'B7': dataset.select('SR_B7')
  }
).rename('Albedo');
Map.addLayer(albedo, {min: 0, max: 1, palette: ['blue', 'white', 'yellow']}, 'Albedo');

var solarRadiation = albedo.multiply(1367).rename('SolarRadiation'); // Approximation using solar constant
Map.addLayer(solarRadiation, {min: 0, max: 1500, palette: ['blue', 'yellow', 'red']}, 'Solar Radiation');

// Evapotranspiration (ET) Calculation
// Use MODIS ET data and downscale to 30 m using NDVI
var modisET = ee.ImageCollection('MODIS/006/MOD16A2')
  .filterDate(startDate, endDate)
  .select('ET')
  .mean()
  .clip(studyBounds);

// Downscaling ET using Landsat NDVI
var ndviMean = ndvi.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: studyBounds,
  scale: 30,
  maxPixels: 1e10
}).get('NDVI');
var downscaledET = modisET.multiply(ndvi.divide(ee.Image.constant(ndviMean))).rename('ET_30m');
Map.addLayer(downscaledET, {min: 0, max: 5, palette: ['blue', 'white', 'green']}, 'Downscaled ET');

// Land Surface Temperature (LST)
var thermal = dataset.select('ST_B10').rename('thermal');
var LST = thermal.expression(
  '(tb / (1 + ((11.5 * (tb / 14380)) * log(em)))) - 273.15',
  {
    'tb': thermal,
    'em': albedo.add(0.95).divide(2) // Approximation for emissivity
  }
).rename('LST');
Map.addLayer(LST, {min: 25, max: 45, palette: ['blue', 'yellow', 'red']}, 'Land Surface Temperature');

// Urban Heat Island (UHI)
var lstMean = LST.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: studyBounds,
  scale: 30,
  maxPixels: 1e10
}).get('LST');
var lstStd = LST.reduceRegion({
  reducer: ee.Reducer.stdDev(),
  geometry: studyBounds,
  scale: 30,
  maxPixels: 1e10
}).get('LST');
var UHI = LST.subtract(ee.Image.constant(lstMean))
             .divide(ee.Image.constant(lstStd))
             .rename('UHI');
Map.addLayer(UHI, {min: -2, max: 2, palette: ['blue', 'white', 'red']}, 'Urban Heat Island');

// Urban Thermal Field Variance Index (UTFVI)
var utfvi = LST.subtract(ee.Image.constant(lstMean)).divide(LST).rename('UTFVI');
Map.addLayer(utfvi, {
  min: 0,
  max: 0.02,
  palette: ['#ffeda0', '#feb24c', '#f03b20']
}, 'UTFVI');

// Export results to Google Drive
Export.image.toDrive({
  image: LST,
  description: 'Land_Surface_Temperature',
  region: studyBounds,
  scale: 30,
  crs: 'EPSG:4326'
});

Export.image.toDrive({
  image: downscaledET,
  description: 'Evapotranspiration_30m',
  region: studyBounds,
  scale: 30,
  crs: 'EPSG:4326'
});

Export.image.toDrive({
  image: solarRadiation,
  description: 'Solar_Radiation',
  region: studyBounds,
  scale: 30,
  crs: 'EPSG:4326'
});

Export.image.toDrive({
  image: UHI,
  description: 'Urban_Heat_Island',
  region: studyBounds,
  scale: 30,
  crs: 'EPSG:4326'
});

Export.image.toDrive({
  image: utfvi,
  description: 'Urban_Thermal_Field_Variance_Index',
  region: studyBounds,
  scale: 30,
  crs: 'EPSG:4326'
});

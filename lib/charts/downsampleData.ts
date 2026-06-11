/**
 * Data downsampling utilities for mobile chart optimization
 * Implements LTTB (Largest-Triangle-Three-Buckets) algorithm with financial integrity guards
 */

/**
 * Downsamples data array using LTTB algorithm with financial integrity preservation
 * @param data - Array of data points to downsample
 * @param maxPoints - Maximum number of points in output (must be >= 3)
 * @param valueKey - Key to use for numeric value comparison
 * @returns Downsampled array with preserved min/max/last points
 */
export function downsampleData<T extends Record<string, unknown>>(
  data: T[],
  maxPoints: number,
  valueKey: string
): T[] {
  if (data.length <= maxPoints || maxPoints < 3) {
    console.log(JSON.stringify({
      type: 'downsample',
      inputLength: data.length,
      outputLength: data.length,
      financialGuardTriggered: false,
      reason: 'no_downsampling_needed'
    }));
    return data;
  }

  // Extract numeric values for LTTB calculation
  const values = data.map(point => {
    const val = point[valueKey];
    return typeof val === 'number' && !isNaN(val) ? val : 0;
  });

  // Find critical points before LTTB
  const originalMin = Math.min(...values);
  const originalMax = Math.max(...values);
  const minIndex = values.indexOf(originalMin);
  const maxIndex = values.indexOf(originalMax);
  const lastIndex = data.length - 1;

  // LTTB implementation
  const bucketSize = (data.length - 2) / (maxPoints - 2);
  const sampled: T[] = [];
  const selectedIndices: number[] = [];
  const areaContributions: number[] = [];

  // Always include first point
  sampled.push(data[0]);
  selectedIndices.push(0);
  areaContributions.push(Infinity); // Never remove first point

  let a = 0; // Index of previously selected point

  for (let i = 0; i < maxPoints - 2; i++) {
    // Calculate bucket range
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length - 1);

    // Skip if bucket is empty or invalid
    if (avgRangeStart >= avgRangeEnd) continue;

    // Calculate average point of next bucket
    let avgRangeSum = 0;
    let avgRangeLength = avgRangeEnd - avgRangeStart;
    
    if (avgRangeLength === 0) {
      // Edge case: use the single point in range
      avgRangeSum = values[avgRangeStart] || 0;
      avgRangeLength = 1;
    } else {
      for (let j = avgRangeStart; j < avgRangeEnd; j++) {
        avgRangeSum += values[j] || 0;
      }
    }
    
    const avgValue = avgRangeLength > 0 ? avgRangeSum / avgRangeLength : 0;

    // Find point in current bucket with largest triangle area
    const bucketStart = Math.floor(i * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length - 1);
    
    let maxArea = -1;
    let selectedIndex = bucketStart;

    for (let j = bucketStart; j < bucketEnd; j++) {
      const pointValue = values[j] || 0;
      const area = Math.abs(
        (values[a] || 0) * (avgValue - pointValue) +
        pointValue * (avgValue - (values[a] || 0))
      );
      
      if (area > maxArea) {
        maxArea = area;
        selectedIndex = j;
      }
    }

    sampled.push(data[selectedIndex]);
    selectedIndices.push(selectedIndex);
    areaContributions.push(maxArea);
    a = selectedIndex;
  }

  // Always include last point
  sampled.push(data[lastIndex]);
  selectedIndices.push(lastIndex);
  areaContributions.push(Infinity); // Never remove last point

  // Financial integrity guard - check if critical points are present
  let financialGuardTriggered = false;
  const sampledValues = sampled.map(point => {
    const val = point[valueKey];
    return typeof val === 'number' && !isNaN(val) ? val : 0;
  });

  const hasMinPoint = sampledValues.some(val => val === originalMin);
  const hasMaxPoint = sampledValues.some(val => val === originalMax);
  const hasLastPoint = selectedIndices.includes(lastIndex);

  // Insert missing critical points and remove lowest-contribution LTTB points
  if (!hasMinPoint || !hasMaxPoint) {
    financialGuardTriggered = true;
    
    const pointsToInsert: { index: number; point: T }[] = [];
    if (!hasMinPoint) pointsToInsert.push({ index: minIndex, point: data[minIndex] });
    if (!hasMaxPoint) pointsToInsert.push({ index: maxIndex, point: data[maxIndex] });

    // Sort by index for proper insertion
    pointsToInsert.sort((a, b) => a.index - b.index);

    // Remove lowest-contribution points (excluding first/last)
    const removableIndices = areaContributions
      .map((area, idx) => ({ area, idx }))
      .filter(item => item.area !== Infinity)
      .sort((a, b) => a.area - b.area)
      .slice(0, pointsToInsert.length)
      .map(item => item.idx);

    // Remove points in reverse order to maintain indices
    removableIndices.sort((a, b) => b - a).forEach(idx => {
      sampled.splice(idx, 1);
      selectedIndices.splice(idx, 1);
    });

    // Insert critical points in correct chronological order
    pointsToInsert.forEach(({ index, point }) => {
      const insertPos = selectedIndices.findIndex(idx => idx > index);
      if (insertPos === -1) {
        sampled.push(point);
        selectedIndices.push(index);
      } else {
        sampled.splice(insertPos, 0, point);
        selectedIndices.splice(insertPos, 0, index);
      }
    });
  }

  // Ensure we never exceed maxPoints
  while (sampled.length > maxPoints) {
    // Remove lowest-contribution point that's not first/last
    let removeIdx = 1; // Start from second point (not first)
    let minArea = Infinity;
    
    for (let i = 1; i < sampled.length - 1; i++) {
      const contribution = areaContributions[i] || 0;
      if (contribution < minArea) {
        minArea = contribution;
        removeIdx = i;
      }
    }
    
    sampled.splice(removeIdx, 1);
    selectedIndices.splice(removeIdx, 1);
    areaContributions.splice(removeIdx, 1);
  }

  console.log(JSON.stringify({
    type: 'downsample',
    inputLength: data.length,
    outputLength: sampled.length,
    financialGuardTriggered,
    originalMin,
    originalMax,
    sampledMin: Math.min(...sampledValues),
    sampledMax: Math.max(...sampledValues)
  }));

  return sampled;
}

/**
 * Validates that sampled data maintains financial accuracy within ±0.1% tolerance
 * @param original - Original data array
 * @param sampled - Downsampled data array
 * @param valueKey - Key to use for numeric value comparison
 * @returns true if accuracy is maintained, false otherwise
 */
export function assertFinancialAccuracy<T extends Record<string, unknown>>(
  original: T[],
  sampled: T[],
  valueKey: string
): boolean {
  const originalValues = original.map(point => {
    const val = point[valueKey];
    return typeof val === 'number' && !isNaN(val) ? val : 0;
  });
  
  const sampledValues = sampled.map(point => {
    const val = point[valueKey];
    return typeof val === 'number' && !isNaN(val) ? val : 0;
  });

  if (originalValues.length === 0 || sampledValues.length === 0) return true;

  const originalMin = Math.min(...originalValues);
  const originalMax = Math.max(...originalValues);
  const sampledMin = Math.min(...sampledValues);
  const sampledMax = Math.max(...sampledValues);

  const minDeviation = Math.abs(originalMin - sampledMin) / Math.abs(originalMin || 1);
  const maxDeviation = Math.abs(originalMax - sampledMax) / Math.abs(originalMax || 1);

  const tolerance = 0.001; // 0.1%
  const isAccurate = minDeviation <= tolerance && maxDeviation <= tolerance;

  if (!isAccurate) {
    console.error('Financial accuracy violation:', {
      originalMin,
      originalMax,
      sampledMin,
      sampledMax,
      minDeviation: (minDeviation * 100).toFixed(3) + '%',
      maxDeviation: (maxDeviation * 100).toFixed(3) + '%',
      tolerance: (tolerance * 100).toFixed(1) + '%'
    });
  }

  return isAccurate;
}

/**
 * Fallback downsampling using uniform stride
 * @param data - Array of data points
 * @param maxPoints - Maximum number of points in output
 * @returns Uniformly downsampled array
 */
export function strideDownsample<T>(
  data: T[],
  maxPoints: number
): T[] {
  if (data.length <= maxPoints) return data;
  
  const stride = Math.floor(data.length / maxPoints);
  const result: T[] = [];
  
  // Always include first point
  result.push(data[0]);
  
  // Add strided points
  for (let i = stride; i < data.length - 1; i += stride) {
    result.push(data[i]);
  }
  
  // Always include last point
  if (data.length > 1) {
    result.push(data[data.length - 1]);
  }
  
  return result;
}
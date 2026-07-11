import Papa from 'papaparse';

export interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Parses a CSV file client-side and returns headers and rows
 */
export const parseCSV = (file: File): Promise<ParsedCSV> => {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        // results.meta.fields contains the header keys
        const headers = results.meta.fields || [];
        resolve({
          headers,
          rows: results.data,
        });
      },
      error: (error) => {
        reject(error);
      },
    });
  });
};

/**
 * Parses a CSV string and returns headers and rows
 */
export const parseCSVText = (text: string): ParsedCSV => {
  const results = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  return {
    headers: results.meta.fields || [],
    rows: results.data,
  };
};
